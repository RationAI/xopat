/// <reference path="../../src/types/globals.d.ts" />
/// <reference path="../../src/types/loader.d.ts" />
/// <reference path="../../modules/recorder/recorder.d.ts" />

type Params={delay:number;duration:number;transition:number};
type AnnObj={presenterSids?:string[];visible?:boolean;dirty?:boolean;canvas?:AnnCanvas;set(v:Record<string,unknown>):void;toObject(k?:string):Record<string,unknown>};
type AnnCanvas={forEachObject(cb:(o:AnnObj)=>void):void;renderAll():void};
type AnnWrap={canvas?:AnnCanvas;loadObjects(input:{objects:Record<string,unknown>[]}):Promise<void>};
type AnnModule={forceExportsProp?:string;fabric?:AnnWrap|{canvas?:AnnCanvas};wrapper?:AnnWrap;canvas?:AnnCanvas;fabricCanvas?:AnnCanvas;initPostIO?():Promise<unknown>;getFabric?(viewer:OpenSeadragon.Viewer):AnnWrap|undefined;trimExportJSON?(data:Record<string,unknown>[],key?:string):unknown;addFabricHandler(event:string,handler:(e:any)=>void):void;enableAnnotations(v:boolean):void};
type Viewer=OpenSeadragon.Viewer&{uniqueId:UniqueViewerId;tools?:RecorderViewerTools};
type RendererWithVisualization=OpenSeadragon.EventSource&{exportVisualization?:()=>RecorderVisualizationSnapshot;getVisualizationSnapshot?:()=>RecorderVisualizationSnapshot;};
type ViewerContextMeta={viewer?:Viewer;index:number;uniqueId?:string;title?:string;label?:string;fileName?:string};
type StepNode=(HTMLCanvasElement|HTMLSpanElement)&{dataset:DOMStringMap};
type NavSession={viewer:Viewer;viewerId:UniqueViewerId;startedAt:number;samples:RecorderNavigationSample[];visualizationSamples:RecorderVisualizationTimedSample[];sampleHandler:()=>void;visualizationHandler?:()=>void;rafPending:boolean;lastSignature:string|null;lastVisualizationSignature:string|null};
const DELAY_PX_PER_SECOND=2;
const DURATION_PX_PER_SECOND=4;
const MIN_DURATION_WIDTH=6;

class RecorderPlugin extends XOpatPlugin{
    private readonly _toolsMenuId="presenter-tools-menu";
    private readonly _capture:Params={delay:2,duration:1.4,transition:6.5};
    private readonly playOnEnter:number;
    private captureAnnotations=true;
    private annotations:AnnModule|null=null;
    private navSession:NavSession|null=null;
    private annotationRefs:Record<string,AnnObj[]>={};
    private oldHighlight:HTMLElement|null=null;
    private selectedIndex:number|null=null;
    private isPlaying=false;
    private measureNode:HTMLSpanElement|null=null;
    private measureLoop:number|undefined;
    private measureDelayPhase=true;
    private measureReferenceStamp=0;
    private measureAbsoluteOffset=0;
    private measureRealtimeOffset=0;
    private measureDuration=0;
    recorder!:RecorderModule; track!:HTMLDivElement; recordPathButton!:HTMLButtonElement; playButton!:HTMLButtonElement; defaultsButton!:HTMLButtonElement;

    constructor(id:string){super(id); const v=Number(this.getOption("playEnterDelay",-1)); this.playOnEnter=Number.isFinite(v)?v:-1;}

    pluginReady():void{
        this.recorder=OpenSeadragon.Recorder.instance();
        this.recorder.setCapturesVisualization(true);
        USER_INTERFACE.Tools.setMenu(this.id,this._toolsMenuId,"Timeline",this._timelineComponent(),"play_circle",true);
        this._renderSlideRows();
        this._syncPlayButton();
        this._syncInputs();
        this._initSortableTimeline(); this._handleInitAnnotationsModule(); this._initEvents();
        if(Number.isInteger(this.playOnEnter)&&this.playOnEnter>=0) window.setTimeout(()=>this.recorder.playFromIndex(0),this.playOnEnter);
    }

    private _timelineComponent():any{
        const self=this; class Panel extends UI.BaseComponent{create(){
            const {button,span,div}=van.tags;
            const icon=(i:string)=>({play:"fa-auto fa-play",stop:"fa-auto fa-stop",trash:"fa-auto fa-trash-can",frame:"fa-auto fa-camera",path:"fa-auto fa-circle-dot",prev:"fa-auto fa-backward",next:"fa-auto fa-forward",defaults:"fa-auto fa-sliders"}[i]||"fa-auto fa-question");
            const btn=(id:string,title:string,ic:string,click:()=>void,extra="")=>button({id,onclick:click,type:"button",class:`btn btn-ghost btn-square btn-sm ${extra}`,title},span({class:icon(ic)}));
            self.recordPathButton=btn("recorder-path-toggle","Record path","path",()=>self.toggleNavigationRecording());
            const controls=div({class:"flex items-center gap-2 flex-wrap"},
                btn("recorder-add-frame","Capture frame","frame",()=>self.addFrame(),"text-info"),
                self.recordPathButton,
                btn("presenter-prev-icon","Previous","prev",()=>self.recorder.previous()),
                self.playButton=btn("presenter-play-icon","Play","play",()=>self.togglePlayback(),"text-success"),
                btn("presenter-next-icon","Next","next",()=>self.recorder.next()),
                btn("presenter-delete-icon","Delete","trash",()=>self.removeHighlightedRecord(),"text-warning"),
                self.defaultsButton=btn("recorder-edit-defaults","Edit defaults for new captures","defaults",()=>self.openDefaultsModal(),"text-base-content/70"),
                new UI.Input({legend:"Delay",suffix:"s",id:"point-delay",size:UI.Input.SIZE.SMALL,onChange:(e:Event)=>self.setValue("delay",parseFloat((e.target as HTMLInputElement).value)),extraProperties:{type:"number",min:"0",step:"0.1",value:self._capture.delay.toString(),style:"width:3.5rem;"}}).create(),
                new UI.Input({legend:"Duration",suffix:"s",id:"point-duration",size:UI.Input.SIZE.SMALL,onChange:(e:Event)=>self.setValue("duration",parseFloat((e.target as HTMLInputElement).value)),extraProperties:{type:"number",min:"0.1",step:"0.1",value:self._capture.duration.toString(),style:"width:3.5rem;"}}).create(),
            );
            self.track=div({id:"presenter-timeline-track",class:"inline-block align-top relative flex-1 px-3 bg-base-200 rounded-sm w-full overflow-x-auto overflow-y-auto",style:"white-space:nowrap;height:48px;min-width:100px;"}) as HTMLDivElement;
            return div({class:"flex flex-col gap-2"},self.track,controls);
        }} return new Panel();
    }

    private _initSortableTimeline():void{
        const tl=this.track; let dragId:string|null=null;
        tl.addEventListener("click",(e:MouseEvent)=>{if(e.target===tl) this.clearSelection();});
        tl.addEventListener("dragstart",(e:DragEvent)=>{const el=(e.target as Element|null)?.closest?.("[data-id]") as HTMLElement|null; if(!el) return; if(this.isPlaying||this.navSession) return void e.preventDefault(); dragId=el.dataset.id||null; if(e.dataTransfer&&dragId){e.dataTransfer.effectAllowed="move"; e.dataTransfer.setData("text/plain",dragId);} el.classList.add("dragging");});
        tl.addEventListener("dragend",(e:DragEvent)=>{((e.target as Element|null)?.closest?.("[data-id]") as HTMLElement|null)?.classList.remove("dragging"); dragId=null;});
        tl.addEventListener("dragover",(e:DragEvent)=>{e.preventDefault(); const after=this._getDragAfterElement(tl,e.clientX),dragging=tl.querySelector<HTMLElement>(".dragging"); if(!dragging) return; if(!after) tl.appendChild(dragging); else tl.insertBefore(dragging,after);});
        tl.addEventListener("drop",(e:DragEvent)=>{e.preventDefault(); const order=Array.from(tl.querySelectorAll<HTMLElement>("[data-id]")).map(n=>n.dataset.id).filter((id):id is string=>!!id); this.recorder.sortWithIdList(order); if(!dragId) return; const el=tl.querySelector<HTMLElement>(`[data-id="${dragId}"]`); if(el) this.selectPoint(el);});
    }

    private _getDragAfterElement(container:HTMLElement,x:number):HTMLElement|null{
        return Array.from(container.querySelectorAll<HTMLElement>("[data-id]:not(.dragging)")).reduce<{offset:number;element:HTMLElement|null}>((res,child)=>{const box=child.getBoundingClientRect(),off=x-box.left-box.width/2; return off<0&&off>res.offset?{offset:off,element:child}:res;},{offset:Number.NEGATIVE_INFINITY,element:null}).element;
    }

    private _getActiveViewer():Viewer|null{return (VIEWER_MANAGER.get?.()||VIEWER_MANAGER.viewers?.[0]||window.VIEWER||null) as Viewer|null;}
    private _resolveActiveViewerId():UniqueViewerId|null{return VIEWER_MANAGER.getActiveUniqueId?.()||this._getActiveViewer()?.uniqueId||null;}
    private _viewerRowHeight():number{return 48;}
    private _insertionIndex():number{return this.selectedIndex===null?this.recorder.snapshotCount():this.selectedIndex+1;}
    private _getViewerContext(viewerOrId:Viewer|UniqueViewerId):ViewerContextMeta|undefined{
        return (UTILITIES as typeof UTILITIES&{getViewerIOContext?:(viewerOrUniqueId:Viewer|UniqueViewerId,stripSuffix?:boolean)=>ViewerContextMeta|undefined}).getViewerIOContext?.(viewerOrId,true);
    }
    private _resolveViewerForStep(step:RecorderSnapshotStep):Viewer|undefined{
        const direct=VIEWER_MANAGER.getViewer(step.viewerId,false) as Viewer|undefined;
        if(direct) return direct;
        if(!step.viewerContextKey) return undefined;
        const matched=((VIEWER_MANAGER.viewers||[]) as Viewer[]).filter(Boolean).find(viewer=>{
            const context=this._getViewerContext(viewer);
            return context?.title===step.viewerContextKey||context?.fileName===step.viewerContextKey||context?.uniqueId===step.viewerContextKey;
        });
        if(matched) step.viewerId=matched.uniqueId;
        return matched;
    }
    private _shortLabel(value:string,max=18):string{return value.length<=max?value:`${value.slice(0,Math.max(0,max-1)).trimEnd()}…`;}

    addFrame():void{
        if(this.isPlaying) return;
        const viewerId=this._resolveActiveViewerId(); if(!viewerId) return void Dialogs.show("No active viewer is available for recording.",2500,Dialogs.MSG_WARN);
        this.recorder.create(viewerId,this._capture.delay,this._capture.duration,this._capture.transition,this._insertionIndex());
    }

    togglePlayback():void{
        if(this.isPlaying) this.recorder.stop();
        else this.recorder.play();
    }

    toggleNavigationRecording():void{ if(this.navSession) this.stopNavigationRecording(true); else this.startNavigationRecording(); }

    private startNavigationRecording():void{
        if(this.isPlaying) return;
        const viewer=this._getActiveViewer(); if(!viewer) return void Dialogs.show("No active viewer is available for path recording.",2500,Dialogs.MSG_WARN);
        const renderer=this._getRenderer(viewer);
        const s:NavSession={viewer,viewerId:viewer.uniqueId,startedAt:performance.now(),samples:[],visualizationSamples:[],rafPending:false,lastSignature:null,lastVisualizationSignature:null,sampleHandler:()=>{if(s.rafPending) return; s.rafPending=true; window.requestAnimationFrame(()=>{s.rafPending=false; this._captureNavigationSample(s);});}};
        if(renderer&&this.recorder.capturesVisualization){
            s.visualizationHandler=()=>this._captureNavigationVisualizationSample(s);
        }
        this.navSession=s; this._captureNavigationSample(s);
        viewer.addHandler("pan",s.sampleHandler);
        viewer.addHandler("zoom",s.sampleHandler);
        viewer.addHandler("animation",s.sampleHandler);
        if(renderer&&s.visualizationHandler) renderer.addHandler("visualization-change",s.visualizationHandler);
        this._syncRecordPathButton();
    }

    private stopNavigationRecording(save:boolean):void{
        const s=this.navSession; if(!s) return;
        const renderer=this._getRenderer(s.viewer);
        s.viewer.removeHandler("pan",s.sampleHandler);
        s.viewer.removeHandler("zoom",s.sampleHandler);
        s.viewer.removeHandler("animation",s.sampleHandler);
        if(renderer&&s.visualizationHandler) renderer.removeHandler("visualization-change",s.visualizationHandler);
        this._captureNavigationSample(s); this.navSession=null; this._syncRecordPathButton();
        if(!save) return;
        if(s.samples.length<2) return void Dialogs.show("Recorded path is too short.",2000,Dialogs.MSG_WARN);
        this.recorder.createNavigation(s.viewerId,s.samples,s.visualizationSamples,this._capture.delay,this._capture.duration,this._capture.transition,this._insertionIndex());
    }

    private _captureNavigationSample(s:NavSession):void{
        const center=s.viewer.viewport.getCenter(), zoom=s.viewer.viewport.getZoom(), bounds=s.viewer.viewport.getBounds(), rotation=s.viewer.viewport.getRotation();
        const sample:RecorderNavigationSample={at:performance.now()-s.startedAt,rotation,point:new OpenSeadragon.Point(center.x,center.y),zoomLevel:zoom,bounds:new OpenSeadragon.Rect(bounds.x,bounds.y,bounds.width,bounds.height)};
        const sig=`${sample.point?.x.toFixed(5)}:${sample.point?.y.toFixed(5)}:${zoom.toFixed(5)}:${rotation.toFixed(3)}:${sample.bounds?.width.toFixed(5)}:${sample.bounds?.height.toFixed(5)}`;
        if(sig===s.lastSignature) return; s.lastSignature=sig; s.samples.push(sample);
    }

    private _getRenderer(viewer:Viewer):RendererWithVisualization|undefined{
        return (viewer as Viewer&{drawer?:{renderer?:RendererWithVisualization}}).drawer?.renderer;
    }

    private _cloneRecorderValue<T>(value:T):T{
        if(Array.isArray(value)) return $.extend(true, [], value) as T;
        if(value&&typeof value==="object") return $.extend(true, {}, value) as T;
        return value;
    }

    private _captureNavigationVisualizationSample(s:NavSession):void{
        const renderer=this._getRenderer(s.viewer);
        const snapshot=renderer?.exportVisualization?.()||renderer?.getVisualizationSnapshot?.();
        if(!snapshot) return;
        const signature=JSON.stringify(snapshot);
        if(signature===s.lastVisualizationSignature) return;
        s.lastVisualizationSignature=signature;
        s.visualizationSamples.push({
            at: performance.now()-s.startedAt,
            visualization: {
                backgrounds: this._cloneRecorderValue(Array.isArray(APPLICATION_CONTEXT.config.background)?APPLICATION_CONTEXT.config.background:[]) as BackgroundItem[],
                activeBackgroundIndex: this._cloneRecorderValue(APPLICATION_CONTEXT.getOption("activeBackgroundIndex",undefined,true,true)) as number|number[]|undefined,
                visualizations: this._cloneRecorderValue(Array.isArray(APPLICATION_CONTEXT.config.visualizations)?APPLICATION_CONTEXT.config.visualizations:[]) as VisualizationItem[],
                activeVisualizationIndex: this._cloneRecorderValue(APPLICATION_CONTEXT.getOption("activeVisualizationIndex",undefined,true,true)) as number|number[]|undefined,
                renderer: this._cloneRecorderValue(snapshot) as RecorderVisualizationSnapshot,
            },
        });
    }

    private _syncRecordPathButton():void{
        if(!this.recordPathButton) return;
        this.recordPathButton.classList.toggle("btn-error",!!this.navSession);
        this.recordPathButton.classList.toggle("text-error",!!this.navSession);
        this.recordPathButton.title=this.navSession?"Stop path recording":"Record path";
    }

    private _syncPlayButton():void{
        if(!this.playButton) return;
        const icon=this.playButton.querySelector("span");
        if(icon) icon.className=this.isPlaying?"fa-auto fa-stop":"fa-auto fa-play";
        this.playButton.title=this.isPlaying?"Stop":"Play";
    }

    private _syncInputs(step?:RecorderSnapshotStep):void{
        const delay=step?.delay ?? this._capture.delay;
        const duration=step?.duration ?? this._capture.duration;
        $("#point-delay").val(delay);
        $("#point-duration").val(duration);
        const delayInput=document.getElementById("point-delay") as HTMLInputElement|null;
        const durationInput=document.getElementById("point-duration") as HTMLInputElement|null;
        if(delayInput) delayInput.value=String(delay);
        if(durationInput) durationInput.value=String(duration);
        if(delayInput) delayInput.title=step?`Step delay. Default: ${this._capture.delay}s`:`Default delay for new captures`;
        if(durationInput) durationInput.title=step?`Step duration. Default: ${this._capture.duration}s`:`Default duration for new captures`;
    }

    openDefaultsModal():void{
        const body=document.createElement("div");
        body.className="flex flex-col gap-4";

        const createNumberField=(label:string,value:number,min:string,step:string)=>{
            const wrapper=document.createElement("label");
            wrapper.className="form-control w-full";
            const caption=document.createElement("span");
            caption.className="label-text text-sm";
            caption.textContent=label;
            const field=document.createElement("input");
            field.type="number";
            field.min=min;
            field.step=step;
            field.value=String(value);
            field.className="input input-bordered input-sm w-full";
            wrapper.append(caption,field);
            return {wrapper,field};
        };
        const createToggle=(label:string,checked:boolean)=>{
            const wrapper=document.createElement("label");
            wrapper.className="label cursor-pointer justify-start gap-3";
            const field=document.createElement("input");
            field.type="checkbox";
            field.checked=checked;
            field.className="toggle toggle-primary toggle-sm";
            const caption=document.createElement("span");
            caption.className="label-text";
            caption.textContent=label;
            wrapper.append(field,caption);
            return {wrapper,field};
        };

        const delayField=createNumberField("Default delay",this._capture.delay,"0","0.1");
        const durationField=createNumberField("Default duration",this._capture.duration,"0.1","0.1");
        const visualizationToggle=createToggle("Capture visualization",!!this.recorder.capturesVisualization);
        const annotationsToggle=createToggle("Capture annotations",this.captureAnnotations);
        body.append(delayField.wrapper,durationField.wrapper,visualizationToggle.wrapper,annotationsToggle.wrapper);

        let modal:InstanceType<typeof UI.Modal>;
        modal=new UI.Modal({
            id:`${this.id}-recorder-defaults-modal`,
            header:"Recorder Defaults",
            body,
            footer:(()=>{
                const footer=document.createElement("div");
                footer.className="flex w-full justify-end gap-2";
                const cancelBtn=document.createElement("button");
                cancelBtn.type="button";
                cancelBtn.className="btn btn-ghost";
                cancelBtn.textContent="Cancel";
                cancelBtn.onclick=()=>modal.close();
                const saveBtn=document.createElement("button");
                saveBtn.type="button";
                saveBtn.className="btn btn-primary";
                saveBtn.textContent="Apply";
                saveBtn.onclick=()=>{
                    const delay=Number(delayField.field.value);
                    const duration=Number(durationField.field.value);
                    if(Number.isFinite(delay)&&delay>=0) this._capture.delay=delay;
                    if(Number.isFinite(duration)&&duration>0) this._capture.duration=duration;
                    this.recorder.setCapturesVisualization(visualizationToggle.field.checked);
                    this.captureAnnotations=annotationsToggle.field.checked;
                    if(this.selectedIndex===null) this._syncInputs();
                    modal.close();
                };
                footer.append(cancelBtn,saveBtn);
                return footer;
            })()
        }).mount();
        modal.open();
    }

    private _ensureMeasureNode():HTMLSpanElement{
        if(this.measureNode&&this.measureNode.isConnected) return this.measureNode;
        const node=document.createElement("span");
        node.id="playback-timeline-measure";
        node.style.position="absolute";
        node.style.top="0";
        node.style.bottom="0";
        node.style.left="0";
        node.style.width="2px";
        node.style.background="rgb(220 38 38)";
        node.style.pointerEvents="none";
        node.style.zIndex="2";
        this.track.appendChild(node);
        this.measureNode=node;
        return node;
    }

    private _clearMeasureLoop():void{
        if(this.measureLoop){window.clearInterval(this.measureLoop); this.measureLoop=undefined;}
        this.measureNode?.remove();
        this.measureNode=null;
    }

    private _startMeasureLoop():void{
        if(this.measureLoop||!this.measureNode) return;
        this.measureLoop=window.setInterval(()=>{
            if(!this.measureNode) return;
            const elapsed=(Date.now()-this.measureReferenceStamp)/1000;
            const finished=!this.measureDelayPhase&&this.measureDuration<elapsed;
            this.measureRealtimeOffset=this.measureAbsoluteOffset+(this.measureDelayPhase
                ? this._delayWidth(elapsed)
                : this._durationOffset(elapsed,this.measureDuration));
            this.measureNode.style.left=`${this.measureRealtimeOffset}px`;
            if(finished){
                this.measureDelayPhase=true;
                this.measureReferenceStamp=Date.now();
                this.measureAbsoluteOffset=this.measureRealtimeOffset;
            }
        },50);
    }

    selectPoint(node:HTMLElement):void{
        const index=Array.from(this.track.querySelectorAll<HTMLElement>("[data-id]")).indexOf(node);
        if(index<0) return;
        this.recorder.goToIndex(index);
        this._highlight(this.recorder.getStep(index),index);
    }

    clearSelection():void{
        this.selectedIndex=null;
        this.track.querySelectorAll<HTMLElement>("[data-id]").forEach(node=>node.classList.remove("outline","outline-2","outline-error"));
        this.oldHighlight=null;
        this._syncInputs();
    }

    setValue(key:keyof Params,value:number):void{
        if(!Number.isFinite(value)) return;
        const step=this.selectedIndex===null?undefined:this.recorder.getStep(this.selectedIndex);
        if(step&&this.selectedIndex!==null){
            step[key]=value;
            const node=this._findUIStep(this.selectedIndex);
            if(node) this._refreshStepNode(node,step);
            this._syncInputs(step);
            return;
        }
        this._capture[key]=value;
        this._syncInputs();
    }

    removeHighlightedRecord():void{
        const index=this.selectedIndex;
        if(index===null) return;
        const child=this._findUIStep(index);
        if(!child) return;
        this.recorder.remove(index);
        child.remove();
        this.clearSelection();
    }
    export():void{UTILITIES.downloadAsFile("visualization-recording.json",JSON.stringify({recorder:this.recorder.exportJSON(false),annotations:this.exportAnnotations(false)}));}

    exportAnnotations(serialize=true):string|Record<string,unknown>{
        if(!this.annotations?.trimExportJSON) return serialize?"{}":{};
        const result:Record<string,unknown>={}; for(const stepId of Object.keys(this.annotationRefs)){const exported=this.annotationRefs[stepId].map(o=>o.toObject("presenterSids")); result[stepId]=this.annotations.trimExportJSON(exported,"presenterSids");}
        return serialize?JSON.stringify(result):result;
    }

    importAnnotations(content:Record<string,unknown>|null|undefined):boolean{
        if(!content||!Object.keys(content).length) return false;
        if(!this.annotations){UTILITIES.loadModules(()=>{this._handleInitAnnotationsModule(); void this._importAnnotations(content);},"annotations"); return true;}
        void this._importAnnotations(content); return true;
    }

    importFromFile(event:Event):void{
        UTILITIES.readFileUploadEvent(event).then((data:string)=>{const parsed=JSON.parse(data) as {recorder?:RecorderSnapshotStep[];snapshots?:RecorderSnapshotStep[];annotations?:Record<string,unknown>}; this.recorder.importJSON(parsed.recorder||parsed.snapshots||[]); if(!this.importAnnotations(parsed.annotations)) Dialogs.show("Loaded.",1500,Dialogs.MSG_INFO);}).catch((error:unknown)=>{console.error(error); Dialogs.show("Failed to load the file.",2500,Dialogs.MSG_ERR);});
    }

    private _highlight(step:RecorderSnapshotStep|undefined,index:number):void{
        this.oldHighlight?.classList.remove("outline","outline-2","outline-error");
        this.selectedIndex=index;
        const node=this._findUIStep(index); this.oldHighlight=node||null; if(!step||!node) return;
        node.classList.add("outline","outline-2","outline-error"); this._syncInputs(step);
    }

    private _resetAllUISteps():void{
        this.track.innerHTML="";
        this._renderSlideRows();
        this.recorder.getSteps().forEach(step=>this._addUIStepFrom(step.viewerId,step,false));
    }

    private _addUIStepFrom(viewerId:UniqueViewerId,step:RecorderSnapshotStep,withNav=true,atIndex?:number):void{
        const viewer=this._resolveViewerForStep(step); if(!viewer) return;
        const node=(step.kind==="navigation"?document.createElement("canvas"):document.createElement("span")) as StepNode;
        node.id=`step-timeline-${step.id}`; node.dataset.id=step.id; node.dataset.group=viewer.uniqueId; node.draggable=true; node.className="inline-block rounded-sm cursor-pointer align-top";
        node.style.position="relative";
        node.style.zIndex="1";
        this._refreshStepNode(node,step,viewer);
        if(typeof atIndex==="number"){const children=Array.from(this.track.querySelectorAll<HTMLElement>("[data-id]")); const before=children[atIndex]; if(before) this.track.insertBefore(node,before); else this.track.appendChild(node);} else this.track.appendChild(node);
        if(withNav&&typeof atIndex==="number"){this.recorder.goToIndex(atIndex); this._highlight(step,atIndex);}
        node.addEventListener("click",(e)=>this.selectPoint(e.currentTarget as HTMLElement));
    }

    private _refreshStepNode(node:StepNode,step:RecorderSnapshotStep,viewer?:Viewer):void{
        const v=viewer||VIEWER_MANAGER.getViewer(step.viewerId) as Viewer|undefined; if(!v) return;
        const size=this._getStepSize(step,v), ratio=Math.max(1,Math.floor(window.devicePixelRatio||1));
        node.style.width=`${size.width}px`; node.style.height=`${size.height}px`; node.style.marginLeft=`${size.marginLeft}px`; node.style.marginTop=`${size.marginTop}px`; node.style.borderBottomLeftRadius=`${size.radius}px`;
        if(node instanceof HTMLCanvasElement){
            node.width=Math.max(1,Math.round(size.width*ratio)); node.height=Math.max(1,Math.round(size.height*ratio)); this._drawStepCanvas(node,step,size,ratio,v);
        }else{
            node.style.background=this._stepColor(step);
            node.style.display="inline-block";
            node.style.borderColor=this._stepColor(step);
        }
    }

    private _getStepSize(step:RecorderSnapshotStep,viewer:Viewer){
        const idx=Math.max(0,VIEWER_MANAGER.getViewerIndex(viewer.uniqueId,false)), zoom=this._representativeZoom(step)??1;
        const maxHeight=Math.max(7,Math.log(viewer.viewport.getMaxZoom())/Math.log(viewer.viewport.getMaxZoom()+1)*18+14);
        const normalHeight=Math.max(7,Math.log(zoom)/Math.log(viewer.viewport.getMaxZoom()+1)*18+14);
        return {width:this._durationWidth(step.duration),height:step.kind==="navigation"?maxHeight:normalHeight,marginLeft:this._delayWidth(step.delay),marginTop:this._viewerRowHeight()*idx,radius:this._metric("transition",step.transition)};
    }

    private _drawStepCanvas(node:HTMLCanvasElement,step:RecorderSnapshotStep,size:{width:number;height:number;radius:number},ratio:number,viewer:Viewer):void{
        const ctx=node.getContext("2d"); if(!ctx) return; const w=Math.max(1,size.width), h=Math.max(1,size.height), r=Math.max(1,Math.min(size.radius,Math.min(w,h)/2)), color=this._stepColor(step);
        ctx.setTransform(ratio,0,0,ratio,0,0); ctx.clearRect(0,0,w,h);
        if(step.kind==="navigation"&&step.navigation?.samples?.length) this._drawNavigationPreview(ctx,step,w,h,color,viewer);
        else {this._roundedRect(ctx,0.5,0.5,w-1,h-1,r); ctx.fillStyle=color; ctx.fill(); ctx.fillStyle="rgba(255,255,255,0.7)"; ctx.fillRect(Math.max(2,w-4),2,2,Math.max(4,h-4));}
    }

    private _roundedRect(ctx:CanvasRenderingContext2D,x:number,y:number,w:number,h:number,r:number):void{
        ctx.beginPath(); ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y); ctx.quadraticCurveTo(x+w,y,x+w,y+r); ctx.lineTo(x+w,y+h-r); ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h); ctx.lineTo(x+r,y+h); ctx.quadraticCurveTo(x,y+h,x,y+h-r); ctx.lineTo(x,y+r); ctx.quadraticCurveTo(x,y,x+r,y); ctx.closePath();
    }

    private _drawNavigationPreview(ctx:CanvasRenderingContext2D,step:RecorderSnapshotStep,w:number,h:number,color:string,viewer:Viewer):void{
        const samples=step.navigation?.samples||[]; if(!samples.length) return;
        ctx.clearRect(0,0,w,h);
        const duration=Math.max(1,samples[samples.length-1]?.at||0);
        const maxZoom=Math.max(1.0001,viewer.viewport.getMaxZoom());
        const bars=new Array<number>(Math.max(1,Math.floor(w))).fill(0);
        for(const sample of samples){
            const zoom=typeof sample.zoomLevel==="number"&&!Number.isNaN(sample.zoomLevel)?sample.zoomLevel:0;
            const x=Math.min(bars.length-1,Math.max(0,Math.floor((sample.at/duration)*(bars.length-1))));
            bars[x]=Math.max(bars[x],zoom);
        }
        ctx.fillStyle=color;
        for(let x=0;x<bars.length;x+=1){
            const zoom=bars[x];
            if(zoom<=0) continue;
            const barHeight=Math.max(1,(Math.log(zoom+1)/Math.log(maxZoom+1))*(h-2));
            ctx.fillRect(x,0,1,barHeight);
        }
    }

    private _stepColor(step:RecorderSnapshotStep):string{ if(this.recorder.stepCapturesVisualization(step)) return this.recorder.stepCapturesViewport(step)||this.recorder.stepCapturesNavigation(step)?"#ffd500":"#9dff00"; if(this.recorder.stepCapturesNavigation(step)||this.recorder.stepCapturesViewport(step)) return "#00d0ff"; return "#000"; }
    private _representativeZoom(step:RecorderSnapshotStep):number|undefined{return typeof step.zoomLevel==="number"?step.zoomLevel:step.navigation?.samples?.[step.navigation.samples.length-1]?.zoomLevel;}
    private _findUIStep(index:number):StepNode|undefined{const step=this.recorder.getStep(index); return step?this.track.querySelector<StepNode>(`[data-id="${step.id}"]`)||undefined:undefined;}
    private _delayWidth(value:number):number{return Math.max(0,value)*DELAY_PX_PER_SECOND;}
    private _durationWidth(value:number):number{return Math.max(MIN_DURATION_WIDTH,MIN_DURATION_WIDTH+Math.max(0,value)*DURATION_PX_PER_SECOND);}
    private _durationOffset(elapsed:number,total:number):number{
        const width=this._durationWidth(total);
        if(total<=0) return width;
        const progress=Math.min(1,Math.max(0,elapsed/total));
        return width*progress;
    }
    private _metric(key:keyof Params,value:number):number{return key==="delay"?this._delayWidth(value):key==="duration"?this._durationWidth(value):value;}

    private _viewerLabel(viewer:Viewer,index:number):string{
        const context=this._getViewerContext(viewer);
        const raw=context?.title
            || context?.fileName
            || (viewer as Viewer&{name?:string;title?:string;label?:string;element?:HTMLElement}).name
            || (viewer as Viewer&{name?:string;title?:string;label?:string;element?:HTMLElement}).title
            || (viewer as Viewer&{name?:string;title?:string;label?:string;element?:HTMLElement}).label
            || (viewer as Viewer&{element?:HTMLElement}).element?.getAttribute("data-title")
            || (viewer as Viewer&{element?:HTMLElement}).element?.getAttribute("title")
            || (viewer as Viewer&{element?:HTMLElement}).element?.id;
        return raw&&raw.trim()?raw.trim():`Slide ${index+1}`;
    }

    private _renderSlideRows():void{
        this.track.querySelectorAll<HTMLElement>("[data-slide-row='true']").forEach(node=>node.remove());
        const viewers=((VIEWER_MANAGER.viewers||[]) as Viewer[]).filter(Boolean);
        const rowHeight=this._viewerRowHeight();
        this.track.style.minHeight=`${rowHeight*Math.min(3, Math.max(1,viewers.length))}px`;
        viewers.forEach((viewer,index)=>{
            const row=document.createElement("div");
            row.dataset.slideRow="true";
            row.className="absolute left-0 right-0 rounded-sm border border-base-300 pointer-events-none";
            row.style.top=`${index*rowHeight}px`;
            row.style.height=`${rowHeight}px`;
            row.style.zIndex="0";
            row.style.backgroundColor="rgba(255,255,255,0.03)";

            const label=document.createElement("span");
            label.className="absolute right-2 bottom-1 text-xs uppercase opacity-60 bg-base-100 px-1 rounded";
            const fullLabel=this._viewerLabel(viewer,index);
            label.textContent=this._shortLabel(fullLabel);
            label.title=fullLabel;
            label.style.pointerEvents="auto";
            label.style.cursor="pointer";
            label.onclick=(event)=>{
                event.stopPropagation();
                const expanded=label.dataset.expanded==="true";
                label.dataset.expanded=expanded?"false":"true";
                label.textContent=expanded?this._shortLabel(fullLabel):fullLabel;
            };
            row.appendChild(label);
            this.track.appendChild(row);
        });
    }

    private _getAnnotationsWrapper(viewerLike?:OpenSeadragon.Viewer):AnnWrap|null{
        const e=this.annotations; if(!e) return null; const viewer=viewerLike||this._getActiveViewer(); const c:Array<AnnWrap|undefined>=[];
        if(viewer&&typeof e.getFabric==="function"){try{c.push(e.getFabric(viewer));}catch(error){console.warn("Recorder: failed to resolve annotations wrapper for viewer.",error);}}
        if(e.fabric&&"loadObjects" in e.fabric) c.push(e.fabric); if(e.wrapper) c.push(e.wrapper); for(const cand of c) if(cand?.canvas) return cand; return null;
    }

    private _getAnnotationsCanvas(viewerLike?:OpenSeadragon.Viewer):AnnCanvas|null{
        const wrapper=this._getAnnotationsWrapper(viewerLike); if(wrapper?.canvas&&typeof wrapper.canvas.forEachObject==="function") return wrapper.canvas;
        const e=this.annotations; if(!e) return null; const c=[e.canvas,e.fabric&&"canvas" in e.fabric?e.fabric.canvas:undefined,e.fabricCanvas]; for(const cand of c) if(cand&&typeof cand.forEachObject==="function") return cand; return null;
    }

    private _renderAnnotations(objects?:AnnObj[]):void{
        const canvases=new Set<AnnCanvas>(); objects?.forEach(o=>{if(o.canvas) canvases.add(o.canvas);});
        if(canvases.size===0) for(const viewer of ((VIEWER_MANAGER.viewers||[]) as OpenSeadragon.Viewer[])){const c=this._getAnnotationsCanvas(viewer); if(c) canvases.add(c);}
        canvases.forEach(c=>c.renderAll());
    }

    private _recordAnnotationRef(annotation:AnnObj,stepId:string):void{const refs=this.annotationRefs[stepId]||[]; if(!refs.includes(annotation)) refs.push(annotation); this.annotationRefs[stepId]=refs;}
    private _removeAnnotationRef(annotation:AnnObj,stepId?:string):boolean{if(!annotation.presenterSids) return false; for(const id of (stepId?[stepId]:annotation.presenterSids)) this._arrRemove(this.annotationRefs[id],annotation); return true;}
    private _arrRemove<T>(array:T[]|undefined,item:T):void{if(!array) return; const i=array.indexOf(item); if(i>-1) array.splice(i,1);}

    private _captureAnnotationsForStep(viewerId:UniqueViewerId,stepId:string):void{
        if(!this.captureAnnotations) return;
        const viewer=VIEWER_MANAGER.getViewer(viewerId) as OpenSeadragon.Viewer|undefined;
        const canvas=this._getAnnotationsCanvas(viewer);
        if(!canvas) return;
        canvas.forEachObject(annotation=>{
            if(annotation.visible===false) return;
            const sids=annotation.presenterSids||[];
            if(!sids.includes(stepId)) sids.push(stepId);
            annotation.presenterSids=sids;
            this._recordAnnotationRef(annotation,stepId);
        });
    }

    private _bindAnnotations():boolean{
        const viewers=((VIEWER_MANAGER.viewers||[]) as OpenSeadragon.Viewer[]).filter(Boolean); if(viewers.length<1) return false;
        let bound=false; this.annotationRefs={}; viewers.forEach(viewer=>{const canvas=this._getAnnotationsCanvas(viewer); if(!canvas) return; canvas.forEachObject(o=>(o.presenterSids||[]).forEach(id=>this._recordAnnotationRef(o,id))); bound=true;}); return bound;
    }

    private _handleInitAnnotationsModule():void{
        try{
            const ctor=(window as Window&{OSDAnnotations?:{instance():AnnModule}}).OSDAnnotations; if(!ctor||this.annotations) return;
            this.annotations=ctor.instance(); this.annotations.forceExportsProp="presenterSids"; void this.annotations.initPostIO?.();
            if(!this._bindAnnotations()){let retries=6; const retry=()=>{if(this._bindAnnotations()||--retries<=0) return; window.setTimeout(retry,150);}; window.setTimeout(retry,150);}
            const add=(o:AnnObj)=>o.presenterSids?.forEach(id=>this._recordAnnotationRef(o,id));
            this.annotations.addFabricHandler("annotation-create",(e)=>add(e.object));
            this.annotations.addFabricHandler("annotation-delete",(e)=>this._removeAnnotationRef(e.object));
            this.annotations.addFabricHandler("annotation-replace",(e)=>{this._removeAnnotationRef(e.previous); e.next.presenterSids=e.previous.presenterSids; add(e.next);});
        }catch(error){console.error(error);}
    }

    private async _importAnnotations(content:Record<string,unknown>):Promise<void>{
        try{
            const data=(typeof content==="string"?JSON.parse(content):content) as Record<string,Record<string,unknown>[]>;
            for(const [stepId,objects] of Object.entries(data)){if(!Array.isArray(objects)) continue; if((objects[0] as {presenterSids?:string[]}|undefined)?.presenterSids) break; objects.forEach(object=>{const sids=Array.isArray((object as {presenterSids?:string[]}).presenterSids)?(object as {presenterSids?:string[]}).presenterSids!:[]; if(!sids.includes(stepId)) sids.push(stepId); (object as {presenterSids?:string[]}).presenterSids=sids;});}
            const wrapper=this._getAnnotationsWrapper(); if(!wrapper?.loadObjects) throw new Error("Annotations wrapper is not ready.");
            await wrapper.loadObjects({objects:Object.values(data).flat(1)}); this._bindAnnotations(); Dialogs.show("Loaded.",1500,Dialogs.MSG_INFO);
        }catch(_error){Dialogs.show("Load finished. Failed to setup annotations: these will be unavailable.",3000,Dialogs.MSG_WARN);}
    }

    private _initEvents():void{
        this.recorder.addHandler("play",()=>{
            this.stopNavigationRecording(false);
            this.isPlaying=true;
            $("#presenter-play-icon span").addClass("timeline-play");
            this._syncPlayButton();
            this._clearMeasureLoop();
            this._ensureMeasureNode();
            this.measureReferenceStamp=Date.now();
            this.measureAbsoluteOffset=0;
            this.measureRealtimeOffset=0;
            this.measureDelayPhase=true;
        });
        this.recorder.addHandler("stop",()=>{
            this.isPlaying=false;
            $("#presenter-play-icon span").removeClass("timeline-play");
            this._syncPlayButton();
            this._clearMeasureLoop();
        });

        this.recorder.addHandler("enter",(e:{step:RecorderSnapshotStep;index:number;prevStep?:RecorderSnapshotStep})=>{
            this._highlight(e.step,e.index);
            const currentNode=this._findUIStep(e.index);
            if(this.isPlaying&&currentNode){
                this._ensureMeasureNode();
                this._startMeasureLoop();
                this.measureDelayPhase=false;
                this.measureDuration=e.step.duration;
                this.measureReferenceStamp=Date.now();
                this.measureAbsoluteOffset=currentNode.getBoundingClientRect().left-this.track.getBoundingClientRect().left-7+this.track.scrollLeft;
                if(this.measureNode) this.measureNode.style.left=`${this.measureAbsoluteOffset}px`;
            }
            let updates=false; const changed:AnnObj[]=[];
            if(e.prevStep){const prev=this.annotationRefs[e.prevStep.id]; if(prev){prev.forEach(a=>{a.visible=false; a.dirty=true; changed.push(a);}); updates=true;}}
            const cur=this.annotationRefs[e.step.id]; if(cur){cur.forEach(a=>{a.visible=true; a.dirty=true; changed.push(a);}); updates=true;}
            if(updates) this._renderAnnotations(changed);
        });
        this.recorder.addHandler("create",(e:{viewerId:UniqueViewerId;step:RecorderSnapshotStep;index:number})=>{
            this._captureAnnotationsForStep(e.viewerId,e.step.id);
            USER_INTERFACE.Tools.notify(this._toolsMenuId);
            this._addUIStepFrom(e.viewerId,e.step,false,e.index);
            this._highlight(e.step,e.index);
        });
        this.recorder.addHandler("remove",(e:{step:RecorderSnapshotStep})=>{const refs=this.annotationRefs[e.step.id]; refs?.forEach(o=>{const i=o.presenterSids?.indexOf(e.step.id)??-1; if(i>=0) o.presenterSids!.splice(i,1);});});
        VIEWER_MANAGER.addHandler("viewer-create",()=>{this._resetAllUISteps();});
        VIEWER_MANAGER.addHandler("viewer-destroy",()=>{this._resetAllUISteps();});
        VIEWER_MANAGER.addHandler("viewer-reset",()=>this._resetAllUISteps());
        VIEWER_MANAGER.addHandler("module-loaded",(e:{id:string})=>{if(e.id==="annotations") this._handleInitAnnotationsModule();});
        VIEWER_MANAGER.addHandler("key-down",(e:KeyboardEvent&{focusCanvas?:boolean})=>{if(!e.focusCanvas) return; if(e.code==="KeyN") this.recorder.goToIndex(this.recorder.currentStepIndex()+1); else if(e.code==="KeyS") this.recorder.goToIndex(0);});
    }
}

addPlugin("recorder",RecorderPlugin);
