/// <reference path="../../src/types/globals.d.ts" />
/// <reference path="../../src/types/loader.d.ts" />
/// <reference path="../../modules/recorder/recorder.d.ts" />

import { OverlayRenderer } from "./overlay-renderer";
import { OverlayEditor } from "./overlay-editor";

type Params={delay:number;duration:number;transition:number};
type AnnObj={presenterSids?:string[];visible?:boolean;dirty?:boolean;canvas?:AnnCanvas;set(v:Record<string,unknown>):void;toObject(k?:string):Record<string,unknown>};
type AnnCanvas={forEachObject(cb:(o:AnnObj)=>void):void;renderAll():void};
type AnnWrap={canvas?:AnnCanvas;loadObjects(input:{objects:Record<string,unknown>[]}):Promise<void>};
type AnnModule={forceExportsProp?:string;fabric?:AnnWrap|{canvas?:AnnCanvas};wrapper?:AnnWrap;canvas?:AnnCanvas;fabricCanvas?:AnnCanvas;getFabric?(viewer:OpenSeadragon.Viewer):AnnWrap|undefined;trimExportJSON?(data:Record<string,unknown>[],key?:string):unknown;addFabricHandler(event:string,handler:(e:any)=>void):void;enableAnnotations(v:boolean):void};
type Viewer=OpenSeadragon.Viewer&{uniqueId:UniqueViewerId;tools?:RecorderViewerTools};
type RendererWithVisualization=OpenSeadragon.EventSource&{exportVisualization?:()=>RecorderVisualizationSnapshot;getVisualizationSnapshot?:()=>RecorderVisualizationSnapshot;};
type ViewerContextMeta={viewer?:Viewer;index:number;uniqueId?:string;title?:string;label?:string;fileName?:string};
type StepNode=(HTMLCanvasElement|HTMLSpanElement)&{dataset:DOMStringMap};
type NavSession={viewer:Viewer;viewerId:UniqueViewerId;startedAt:number;samples:RecorderNavigationSample[];visualizationSamples:RecorderVisualizationTimedSample[];visualizationHandler?:()=>void;rafId:number;lastVisualizationSignature:string|null};
const DELAY_PX_PER_SECOND=2;
const DURATION_PX_PER_SECOND=4;
const MIN_DURATION_WIDTH=6;
const SMOOTH_POINT_EPS=0.0005;
const SMOOTH_ZOOM_REL_EPS=0.005;
const SMOOTH_ROT_EPS=0.25;

class RecorderPlugin extends XOpatPlugin{
    private readonly _toolsMenuId="presenter-tools-menu";
    private readonly _capture:Params={delay:2,duration:1.4,transition:6.5};
    private readonly playOnEnter:number;
    private captureAnnotations=true;
    private smoothPath=false;
    private annotations:AnnModule|null=null;
    /** Active navigation-recording sessions, one per armed viewer (synchronized). */
    private navSessions:Map<UniqueViewerId,NavSession>=new Map();
    private _navRafId=0;
    private _navStartedAt=0;
    private annotationRefs:Record<string,AnnObj[]>={};
    private oldHighlight:HTMLElement|null=null;
    private selectedIndex:number|null=null;
    private selectedViewerId:UniqueViewerId|null=null;
    /** Viewers armed for capture (explicit, sticky — independent of hover). */
    private armed:Set<UniqueViewerId>=new Set();
    /** Explicit current/primary viewer for editing context (NOT hover-driven). */
    private currentViewerId:UniqueViewerId|null=null;
    private isPlaying=false;
    private measureNode:HTMLSpanElement|null=null;
    private measureLoop:number|undefined;
    private measureDelayPhase=true;
    private measureReferenceStamp=0;
    private measureAbsoluteOffset=0;
    private measureRealtimeOffset=0;
    private measureDuration=0;
    recorder!:RecorderModule; track!:HTMLDivElement;
    /** Inner <input> nodes of the two UI.Input controls (no document lookups). */
    private _delayInput:HTMLInputElement|null=null;
    private _durationInput:HTMLInputElement|null=null;
    private _recordingsModal:InstanceType<typeof UI.Modal>|null=null;
    private _recordingsBody:HTMLElement|null=null;
    /** Per-lane reactive chrome state, so lane repaints are state writes. */
    private _laneStates:Map<UniqueViewerId,{current:any;armed:any}>=new Map();
    private _states:{playing:any;pathRecording:any;activeName:any}|null=null;
    overlayRenderer!:OverlayRenderer;

    /**
     * Reactive toolbar state. Lazily built so `van` is only touched once the
     * UI bundle is up (the constructor runs during early boot).
     */
    private get ui(){
        return this._states ??= {
            playing: van.state(false),
            pathRecording: van.state(false),
            activeName: van.state(this.t("recording")),
        };
    }


    constructor(id:string){super(id); const v=Number(this.getOption("playEnterDelay",-1)); this.playOnEnter=Number.isFinite(v)?v:-1; this.smoothPath=!!this.getOption("smoothPath",false);}

    async pluginReady():Promise<void>{
        await this.loadLocale();
        this.recorder=OpenSeadragon.Recorder.instance();
        this.recorder.setCapturesVisualization(true);
        this.overlayRenderer=new OverlayRenderer(this.recorder);
        USER_INTERFACE.Tools.setMenu(this.id,this._toolsMenuId,this.t("timeline"),this._timelineComponent(),"ph-play-circle",true);
        // Seed the explicit current viewer once from the active viewer, and arm it.
        const initId=this._currentViewerId(); if(initId) this.armed.add(initId);
        this._resetAllUISteps();
        this._syncRecordingsButton();
        this._syncPlayButton();
        this._syncInputs();
        this._initSortableTimeline(); this._handleInitAnnotationsModule(); this._initEvents();
        if(Number.isInteger(this.playOnEnter)&&this.playOnEnter>=0) window.setTimeout(()=>this.recorder.playFromIndex(0),this.playOnEnter);
    }

    private _timelineComponent():any{
        const self=this; class Panel extends UI.BaseComponent{create(){
            const {span,div,button}=van.tags;
            const st=self.ui;
            const btn=(id:string,title:string,ic:string,click:()=>void,extra="")=>self._iconButton({id,title,icon:ic,onClick:click,extraClasses:`btn-square ${extra}`});
            const controls=div({class:"flex items-center gap-2 flex-wrap"},
                // Labeled entry point to the Recordings manager (switch / new / rename
                // / duplicate / delete / export live in the modal, not the toolbar).
                new UI.Button({
                    id:"recorder-recordings",onClick:()=>self._openRecordingsModal(),
                    extraClasses:{v:"btn-ghost btn-sm gap-1"},
                    extraProperties:{type:"button",title:self.t("manageRecordings")},
                },new UI.PhIcon("ph-film-strip"),
                    span({id:"recorder-active-name"},()=>st.activeName.val),
                    span({class:"recorder-caret ph-light ph-caret-down opacity-60"})).create(),
                btn("recorder-add-frame",self.t("captureFrame"),"ph-camera",()=>self.addFrame(),"text-info"),
                // Path toggle and Play carry recording/playing state, so their
                // class and title are bound to van states instead of being
                // re-poked through document lookups.
                button({
                    id:"recorder-path-toggle",type:"button",onclick:()=>self.toggleNavigationRecording(),
                    class:()=>`btn btn-ghost btn-square btn-sm ${st.pathRecording.val?"btn-error text-error":""}`,
                    title:()=>st.pathRecording.val?self.t("stopPathRecording",{count:self.navSessions.size}):self.t("recordPath"),
                },span({class:"ph-light ph-record"})),
                btn("presenter-prev-icon",self.t("previous"),"ph-rewind",()=>self.recorder.previous()),
                button({
                    id:"presenter-play-icon",type:"button",onclick:()=>self.togglePlayback(),
                    class:"btn btn-ghost btn-square btn-sm text-success",
                    title:()=>st.playing.val?self.t("stop"):self.t("play"),
                },span({class:()=>`ph-light ${st.playing.val?"ph-stop timeline-play":"ph-play"}`})),
                btn("presenter-next-icon",self.t("next"),"ph-fast-forward",()=>self.recorder.next()),
                btn("presenter-delete-icon",self.t("deleteStep"),"ph-trash-simple",()=>self.removeHighlightedRecord(),"text-warning"),
                btn("recorder-edit-defaults",self.t("editDefaults"),"ph-sliders-horizontal",()=>self.openDefaultsModal(),"text-base-content/70"),
                self._numberInput("point-delay",self.t("delay"),self._capture.delay,"0",v=>self.setValue("delay",v),el=>self._delayInput=el),
                self._numberInput("point-duration",self.t("duration"),self._capture.duration,"0.1",v=>self.setValue("duration",v),el=>self._durationInput=el),
            );
            // One lane (a block child) per viewer; each lane flows its steps
            // independently from x=0 so equal per-index timing column-aligns
            // across lanes. The track scrolls all lanes horizontally together.
            self.track=div({id:"presenter-timeline-track",class:"relative flex-1 px-3 bg-base-200 rounded-sm w-full overflow-x-auto overflow-y-auto flex flex-col items-start gap-1",style:"min-height:48px;min-width:100px;"}) as HTMLDivElement;
            return div({class:"flex flex-col gap-2"},self.track,controls);
        }} return new Panel();
    }

    /**
     * Ghost icon button built from the core UI atoms (UI.Button + UI.PhIcon) —
     * the single place icon buttons are produced in this plugin.
     */
    private _iconButton(o:{title:string;icon:string;onClick:()=>void;id?:string;extraClasses?:string}):HTMLElement{
        return new UI.Button({
            ...(o.id?{id:o.id}:{}),
            onClick:o.onClick,
            extraClasses:{v:`btn-ghost btn-sm ${o.extraClasses??""}`},
            extraProperties:{type:"button",title:o.title},
        },new UI.PhIcon(o.icon)).create() as HTMLElement;
    }

    /**
     * Delay / duration field. UI.Input owns the markup; we keep the inner
     * <input> so the value can be synced without a document lookup.
     */
    private _numberInput(id:string,legend:string,value:number,min:string,onChange:(v:number)=>void,ref?:(el:HTMLInputElement)=>void,width="3.5rem"):HTMLElement{
        const node=new UI.Input({
            legend,suffix:"s",id,size:UI.Input.SIZE.SMALL,
            onChange:(e:Event)=>onChange(parseFloat((e.target as HTMLInputElement).value)),
            extraProperties:{type:"number",min,step:"0.1",value:String(value),style:`width:${width};`},
        }).create() as HTMLElement;
        const field=node.querySelector("input");
        if(field&&ref) ref(field);
        return node;
    }

    private _initSortableTimeline():void{
        const tl=this.track; let dragId:string|null=null;
        tl.addEventListener("click",(e:MouseEvent)=>{if(e.target===tl) this.clearSelection();});
        tl.addEventListener("dragstart",(e:DragEvent)=>{const el=(e.target as Element|null)?.closest?.("[data-id]") as HTMLElement|null; if(!el) return; if(this.isPlaying||this.navSessions.size) return void e.preventDefault(); dragId=el.dataset.id||null; if(e.dataTransfer&&dragId){e.dataTransfer.effectAllowed="move"; e.dataTransfer.setData("text/plain",dragId);} el.classList.add("dragging");});
        tl.addEventListener("dragend",(e:DragEvent)=>{((e.target as Element|null)?.closest?.("[data-id]") as HTMLElement|null)?.classList.remove("dragging"); dragId=null;});
        tl.addEventListener("dragover",(e:DragEvent)=>{e.preventDefault(); const dragging=tl.querySelector<HTMLElement>(".dragging"); if(!dragging) return; const lane=dragging.closest("[data-lane]") as HTMLElement|null; if(!lane) return; const after=this._getDragAfterElement(lane,e.clientX); if(!after) lane.appendChild(dragging); else lane.insertBefore(dragging,after);});
        tl.addEventListener("drop",(e:DragEvent)=>{e.preventDefault(); if(!dragId) return; const el=tl.querySelector<HTMLElement>(`[data-id="${dragId}"]`); if(!el) return; const viewerId=(el.dataset.group||"") as UniqueViewerId;
            // Reorder only within the dragged step's own lane (its recording).
            const order=Array.from(tl.querySelectorAll<HTMLElement>(`[data-id][data-group="${viewerId}"]`)).map(n=>n.dataset.id).filter((id):id is string=>!!id); this.recorder.sortWithIdList(order,false,viewerId); this.selectPoint(el);});
    }

    private _getDragAfterElement(container:HTMLElement,x:number):HTMLElement|null{
        return Array.from(container.querySelectorAll<HTMLElement>("[data-id]:not(.dragging)")).reduce<{offset:number;element:HTMLElement|null}>((res,child)=>{const box=child.getBoundingClientRect(),off=x-box.left-box.width/2; return off<0&&off>res.offset?{offset:off,element:child}:res;},{offset:Number.NEGATIVE_INFINITY,element:null}).element;
    }

    /**
     * The recorder's explicit current/primary viewer — drives the Recordings
     * modal, delay/duration inputs, step selection and toolbar name. Unlike
     * VIEWER_MANAGER's active viewer it is NOT changed by hover; it only seeds
     * from the active viewer once (or when the current one is destroyed).
     */
    private _currentViewerId():UniqueViewerId|null{
        const id=this.currentViewerId;
        if(id&&VIEWER_MANAGER.getViewer(id,false)) return id;
        const fallback=(VIEWER_MANAGER.getActiveUniqueId?.()||((VIEWER_MANAGER.viewers||[])[0] as Viewer|undefined)?.uniqueId)||null;
        this.currentViewerId=fallback;
        return fallback;
    }
    private _currentViewer():Viewer|null{const id=this._currentViewerId(); return id?(VIEWER_MANAGER.getViewer(id,false) as Viewer|undefined)||null:null;}
    /** Back-compat aliases kept for existing call sites (now hover-independent). */
    private _getActiveViewer():Viewer|null{return this._currentViewer();}
    private _resolveActiveViewerId():UniqueViewerId|null{return this._currentViewerId();}
    private _setCurrentViewer(id:UniqueViewerId):void{
        if(!id||this.currentViewerId===id) return;
        this.currentViewerId=id;
        this._refreshLaneChrome();
        this._syncRecordingsButton();
        this._refreshRecordingsModal();
        this._syncInputs();
    }
    /** Viewers a capture/path-record should target: the armed set, else current. */
    private _recordTargets():UniqueViewerId[]{
        const open=new Set(((VIEWER_MANAGER.viewers||[]) as Viewer[]).filter(Boolean).map(v=>v.uniqueId));
        const targets=[...this.armed].filter(id=>open.has(id));
        if(targets.length) return targets;
        const cur=this._currentViewerId();
        return cur?[cur]:[];
    }
    private _viewerRowHeight():number{return 48;}
    private _insertionIndex(viewerId:UniqueViewerId):number{
        // Honour the highlighted step only when it belongs to the viewer we are
        // capturing into; otherwise append to that viewer's recording.
        if(this.selectedIndex===null||this.selectedViewerId!==viewerId) return this.recorder.snapshotCount(viewerId);
        return this.selectedIndex+1;
    }
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

    /** Reflect the active viewer's active recording name on the toolbar button. */
    private _syncRecordingsButton():void{
        const viewerId=this._resolveActiveViewerId();
        const active=viewerId?this.recorder.getActiveRecording(viewerId):undefined;
        this.ui.activeName.val=active?active.name:this.t("recording");
    }

    /** Open (or focus) the Recordings manager modal for the active viewer. */
    private _openRecordingsModal():void{
        const {div}=van.tags;
        const host=div({class:"flex flex-col gap-3 min-w-[22rem]"});
        this._recordingsBody=host;
        this._refreshRecordingsModal();

        let modal:InstanceType<typeof UI.Modal>;
        const footer=div({class:"flex w-full justify-between gap-2"},
            div({class:"flex gap-2"},
                this._labeledButton(this.t("exportAll"),"ph-download",()=>{void this.export();}),
                this._labeledButton(this.t("import"),"ph-upload",()=>this._importRecordingsPrompt()),
            ),
            new UI.Button({
                onClick:()=>modal.close(),
                extraClasses:{v:"btn-primary btn-sm"},
                extraProperties:{type:"button"},
            },$.t("common.Close")).create(),
        );
        modal=new UI.Modal({
            id:`${this.id}-recorder-recordings-modal`,
            header:this.t("recordings"),
            body:host,
            footer,
        }).mount();
        const origClose=modal.close.bind(modal);
        modal.close=()=>{this._recordingsModal=null; this._recordingsBody=null; return origClose();};
        this._recordingsModal=modal;
        modal.open();
    }

    /** Ghost button with an icon and a text label. */
    private _labeledButton(label:string,icon:string,onClick:()=>void):HTMLElement{
        return new UI.Button({
            onClick,
            extraClasses:{v:"btn-ghost btn-sm gap-1"},
            extraProperties:{type:"button"},
        },new UI.PhIcon(icon),label).create() as HTMLElement;
    }

    /**
     * Rebuild the modal body — called on lifecycle changes while open.
     * Recordings are per-viewer collections (keyed by UniqueViewerId), so the
     * modal renders ONE section per open viewer, mirroring the timeline lanes.
     * The current/editing viewer's section is highlighted.
     */
    private _refreshRecordingsModal():void{
        const host=this._recordingsBody; if(!host) return;
        const {div}=van.tags;
        const viewers=((VIEWER_MANAGER.viewers||[]) as Viewer[]).filter(Boolean);
        if(!viewers.length){host.replaceChildren(div({class:"opacity-70 text-sm"},this.t("noViewer"))); return;}
        const currentId=this._currentViewerId();
        host.replaceChildren(...viewers.map(viewer=>this._renderViewerRecordingSection(viewer,viewer.uniqueId===currentId)));
    }

    /** Render one viewer's recording collection as a labelled section. */
    private _renderViewerRecordingSection(viewer:Viewer,isCurrent:boolean):HTMLElement{
        const {div,label,span,input}=van.tags;
        const viewerId=viewer.uniqueId;
        const recordings=this.recorder.listRecordings(viewerId);
        const activeId=this.recorder.getActiveRecording(viewerId)?.id;
        const iconBtn=(title:string,icon:string,onClick:()=>void,extra="")=>
            this._iconButton({title,icon,onClick,extraClasses:`btn-square ${extra}`});

        return div({class:`flex flex-col gap-1 rounded-md p-2 border-l-2 ${isCurrent?"bg-base-200 border-primary":"border-transparent"}`},
            // Clicking a section header makes it the current/editing viewer (keeps
            // the toolbar name, delay/duration inputs and lane highlight in sync).
            div({class:"text-xs uppercase opacity-60 truncate cursor-pointer",onclick:()=>this._setCurrentViewer(viewerId)},
                this._viewerLabel(viewer,Math.max(0,VIEWER_MANAGER.getViewerSlotIndex(viewer)))),
            ...recordings.map(rec=>label({class:"flex items-center gap-2 rounded-sm px-2 py-1 hover:bg-base-300 cursor-pointer"},
                // Per-viewer group name: each viewer has its own active recording,
                // so their radios must NOT share one exclusive group.
                input({type:"radio",name:`${this.id}-rec-active-${viewerId}`,class:"radio radio-sm",
                    checked:rec.id===activeId,onchange:()=>this.recorder.setActiveRecording(rec.id,viewerId)}),
                span({class:"flex-1 truncate"},rec.name),
                span({class:"text-xs opacity-50"},this.t("stepCount",{count:rec.steps.length})),
                iconBtn(this.t("renameRecording"),"ph-pencil-simple",()=>this._renameRecordingPrompt(viewerId,rec.id)),
                iconBtn(this.t("duplicateRecording"),"ph-copy",()=>this.recorder.duplicateRecording(rec.id,viewerId)),
                iconBtn(this.t("exportRecording"),"ph-download",()=>{this.recorder.setActiveRecording(rec.id,viewerId); this.recorder.downloadActiveRecording(viewerId);}),
                iconBtn(this.t("deleteRecording"),"ph-trash-simple",()=>this.recorder.deleteRecording(rec.id,viewerId),"text-warning"),
            )),
            new UI.Button({
                onClick:()=>this.recorder.createRecording(viewerId),
                extraClasses:{v:"btn-ghost btn-sm gap-1 self-start"},
                extraProperties:{type:"button"},
            },new UI.PhIcon({name:"ph-plus",extraClasses:{c:"text-success"}}),this.t("newRecording")).create(),
        ) as HTMLElement;
    }

    /**
     * Load recordings from a file the user picks. Additive: the module merges
     * them into the active viewer's collection, so nothing already recorded is
     * lost — see Recorder.importRecordings.
     */
    private _importRecordingsPrompt():void{
        const viewerId=this._resolveActiveViewerId();
        if(!viewerId) return void Dialogs.show(this.t("importNoViewer"),2500,Dialogs.MSG_WARN);
        UTILITIES.uploadFile((content:string|ArrayBuffer)=>{
            // uploadFile routes read failures to the same callback, handing it
            // the error instead of the contents.
            if(typeof content!=="string") return void Dialogs.show(this.t("importUnreadable"),2500,Dialogs.MSG_ERR);
            try{
                const imported=this.recorder.importRecordings(viewerId,content,{activate:true});
                Dialogs.show(this.t("imported",{count:imported.length}),2500,Dialogs.MSG_INFO);
            }catch(e:any){
                Dialogs.show(this.t("importFailed",{reason:e?.userMessage??e?.message??String(e)}),4000,Dialogs.MSG_ERR);
            }
        },".json,application/json","text");
    }

    private _renameRecordingPrompt(viewerId:UniqueViewerId,recordingId?:string):void{
        const target=recordingId?this.recorder.listRecordings(viewerId).find(r=>r.id===recordingId):this.recorder.getActiveRecording(viewerId);
        if(!target) return;
        const {div}=van.tags;
        const nameInput=new UI.Input({
            size:UI.Input.SIZE.SMALL,
            extraClasses:{w:"w-full"},
            extraProperties:{type:"text",value:target.name},
        }).create() as HTMLInputElement;
        let modal:InstanceType<typeof UI.Modal>;
        const footer=div({class:"flex w-full justify-end gap-2"},
            this._modalButton($.t("common.cancel"),"btn-ghost",()=>modal.close()),
            this._modalButton(this.t("save"),"btn-primary",()=>{
                const v=nameInput.value.trim();
                if(v) this.recorder.renameRecording(target.id,v,viewerId);
                modal.close();
            }),
        );
        modal=new UI.Modal({
            id:`${this.id}-recorder-rename-modal`,
            header:this.t("renameRecordingTitle"),
            body:div({class:"flex flex-col gap-3"},nameInput),
            footer,
        }).mount();
        modal.open();
    }

    /** Text-only modal action button. */
    private _modalButton(label:string,style:string,onClick:()=>void):HTMLElement{
        return new UI.Button({
            onClick,
            extraClasses:{v:style},
            extraProperties:{type:"button"},
        },label).create() as HTMLElement;
    }

    addFrame():void{
        if(this.isPlaying) return;
        const targets=this._recordTargets(); if(!targets.length) return void Dialogs.show(this.t("armToCapture"),2500,Dialogs.MSG_WARN);
        if(targets.length===1){
            // Single armed viewer: honour selection-based mid-insert.
            const only=targets[0]!;
            const step=this.recorder.create(only,this._capture.delay,this._capture.duration,this._capture.transition,this._insertionIndex(only));
            // An unchanged view collapses to a hold. That is the right thing to
            // store, but silently it reads as "the button did nothing" — say so.
            if(step&&step.kind==="empty") Dialogs.show(this.t("captureCollapsedToHold"),3000,Dialogs.MSG_INFO);
            return;
        }
        // Simultaneous: align lanes to a common index, then append one step to
        // each. The module collapses an unchanged viewer's frame to an empty
        // spacer (a hold), so non-recording viewers just get a space.
        this._alignArmedLanes(targets);
        for(const viewerId of targets) this.recorder.create(viewerId,this._capture.delay,this._capture.duration,this._capture.transition);
    }

    /**
     * Pad every target's active recording with empty spacers up to the longest
     * one, so a subsequent append lands at the same index in every lane (keeps
     * simultaneous lanes index- and time-aligned, incl. late-armed viewers).
     */
    private _alignArmedLanes(targets:UniqueViewerId[]):void{
        const counts=targets.map(v=>this.recorder.snapshotCount(v));
        const T=Math.max(0,...counts);
        const refV=targets[counts.indexOf(T)];
        for(const v of targets){
            for(let i=this.recorder.snapshotCount(v); i<T; i++){
                const ref=refV?this.recorder.getStep(i,refV):undefined;
                this.recorder.createEmpty(v, ref?.delay??0, ref?.duration??this._capture.duration, ref?.transition??this._capture.transition);
            }
        }
    }

    togglePlayback():void{
        if(this.isPlaying) this.recorder.stop();
        else this.recorder.play();
    }

    toggleNavigationRecording():void{ if(this.navSessions.size) this.stopNavigationRecording(true); else this.startNavigationRecording(); }

    private startNavigationRecording():void{
        if(this.isPlaying) return;
        const targets=this._recordTargets()
            .map(id=>VIEWER_MANAGER.getViewer(id,false) as Viewer|undefined)
            .filter((v):v is Viewer=>!!v?.viewport);
        if(!targets.length) return void Dialogs.show(this.t("armToRecordPath"),2500,Dialogs.MSG_WARN);
        // All armed viewers share one start clock so their paths replay in sync,
        // preserving cross-viewer choreography (A moves while B holds, etc.).
        this._navStartedAt=performance.now();
        this.navSessions.clear();
        for(const viewer of targets){
            const s:NavSession={viewer,viewerId:viewer.uniqueId,startedAt:this._navStartedAt,samples:[],visualizationSamples:[],rafId:0,lastVisualizationSignature:null};
            const renderer=this._getRenderer(viewer);
            if(renderer&&this.recorder.capturesVisualization){
                s.visualizationHandler=()=>this._captureNavigationVisualizationSample(s);
                renderer.addHandler("visualization-change",s.visualizationHandler);
            }
            this._captureNavigationSample(s);
            this.navSessions.set(viewer.uniqueId,s);
        }
        // Single shared rAF samples every armed viewer each frame so wall-clock
        // timing (including idle holds) is captured identically across lanes.
        const tick=()=>{
            if(!this.navSessions.size) return;
            for(const s of this.navSessions.values()) this._captureNavigationSample(s);
            this._navRafId=window.requestAnimationFrame(tick);
        };
        this._navRafId=window.requestAnimationFrame(tick);
        this._syncRecordPathButton();
    }

    private stopNavigationRecording(save:boolean):void{
        if(!this.navSessions.size) return;
        if(this._navRafId) window.cancelAnimationFrame(this._navRafId);
        this._navRafId=0;
        const sessions=[...this.navSessions.values()];
        for(const s of sessions){
            const renderer=this._getRenderer(s.viewer);
            if(renderer&&s.visualizationHandler) renderer.removeHandler("visualization-change",s.visualizationHandler);
            this._captureNavigationSample(s);
        }
        this.navSessions.clear();
        this._syncRecordPathButton();
        if(!save) return;
        const multi=sessions.length>1;
        if(multi) this._alignArmedLanes(sessions.map(s=>s.viewerId));
        let saved=0;
        for(const s of sessions){
            if(s.samples.length<2){
                // Keep alignment: an untouched lane still gets a hold of matching length.
                if(multi) this.recorder.createEmpty(s.viewerId,this._capture.delay,this._capture.duration,this._capture.transition);
                continue;
            }
            // createNavigation collapses a motionless path to an empty hold itself.
            this.recorder.createNavigation(s.viewerId,s.samples,s.visualizationSamples,this._capture.delay,this._capture.duration,this._capture.transition,multi?undefined:this._insertionIndex(s.viewerId));
            saved++;
        }
        if(!saved&&!multi) Dialogs.show(this.t("pathTooShort"),2000,Dialogs.MSG_WARN);
    }

    private _captureNavigationSample(s:NavSession):void{
        const center=s.viewer.viewport.getCenter(), zoom=s.viewer.viewport.getZoom(), bounds=s.viewer.viewport.getBounds(), rotation=s.viewer.viewport.getRotation();
        const sample:RecorderNavigationSample={at:performance.now()-s.startedAt,rotation,point:new OpenSeadragon.Point(center.x,center.y),zoomLevel:zoom,bounds:new OpenSeadragon.Rect(bounds.x,bounds.y,bounds.width,bounds.height)};
        // Smooth mode: if the new sample continues the linear trajectory of the
        // previous two within tolerance, replace the previous one instead of
        // appending. Effectively a streaming line-fit: holds collapse to two
        // samples, constant pans/zooms to two, inertia decays to a few.
        if(this.smoothPath&&s.samples.length>=2&&this._continuesLinearTrend(s.samples[s.samples.length-2],s.samples[s.samples.length-1],sample)){
            s.samples[s.samples.length-1]=sample;
            return;
        }
        s.samples.push(sample);
    }

    private _continuesLinearTrend(a:RecorderNavigationSample,b:RecorderNavigationSample,c:RecorderNavigationSample):boolean{
        const dt1=b.at-a.at, dt2=c.at-b.at;
        if(dt1<=0||dt2<=0) return false;
        const scale=dt2/dt1;
        if(a.point&&b.point&&c.point){
            const predX=b.point.x+(b.point.x-a.point.x)*scale;
            const predY=b.point.y+(b.point.y-a.point.y)*scale;
            if(Math.abs(predX-c.point.x)>SMOOTH_POINT_EPS) return false;
            if(Math.abs(predY-c.point.y)>SMOOTH_POINT_EPS) return false;
        }
        if(typeof a.zoomLevel==="number"&&typeof b.zoomLevel==="number"&&typeof c.zoomLevel==="number"){
            const predZ=b.zoomLevel+(b.zoomLevel-a.zoomLevel)*scale;
            const tol=Math.max(Math.abs(b.zoomLevel),1e-6)*SMOOTH_ZOOM_REL_EPS;
            if(Math.abs(predZ-c.zoomLevel)>tol) return false;
        }
        if(typeof a.rotation==="number"&&typeof b.rotation==="number"&&typeof c.rotation==="number"){
            const predR=b.rotation+(b.rotation-a.rotation)*scale;
            if(Math.abs(predR-c.rotation)>SMOOTH_ROT_EPS) return false;
        }
        return true;
    }

    private _getRenderer(viewer:Viewer):RendererWithVisualization|undefined{
        return (viewer as Viewer&{drawer?:{renderer?:RendererWithVisualization}}).drawer?.renderer;
    }

    private _cloneRecorderValue<T>(value:T):T{
        if(Array.isArray(value)) return OpenSeadragon.extend(true, [], value) as T;
        if(value&&typeof value==="object") return OpenSeadragon.extend(true, {}, value) as T;
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
            visualization: (() => {
                const backgrounds = this._cloneRecorderValue(Array.isArray(APPLICATION_CONTEXT.config.background)?APPLICATION_CONTEXT.config.background:[]) as BackgroundItem[];
                const activeBackgroundIndex = this._cloneRecorderValue(APPLICATION_CONTEXT.getOption("activeBackgroundIndex",undefined,true,true)) as number|number[]|undefined;
                const visualizations = this._cloneRecorderValue(Array.isArray(APPLICATION_CONTEXT.config.visualizations)?APPLICATION_CONTEXT.config.visualizations:[]) as VisualizationItem[];
                const bgArr = Array.isArray(activeBackgroundIndex) ? activeBackgroundIndex : (Number.isInteger(activeBackgroundIndex) ? [activeBackgroundIndex as number] : []);
                const activeVisualizationIndex = bgArr.map((bgIdx: any) => {
                    const v = Number.isInteger(bgIdx) ? (backgrounds[bgIdx as number] as any)?.visualizationIndex : undefined;
                    return Number.isInteger(v) ? v as number : undefined;
                });
                return {
                    backgrounds,
                    activeBackgroundIndex,
                    visualizations,
                    activeVisualizationIndex: activeVisualizationIndex as unknown as number|number[]|undefined,
                    renderer: this._cloneRecorderValue(snapshot) as RecorderVisualizationSnapshot,
                };
            })(),
        });
    }

    private _syncRecordPathButton():void{
        this.ui.pathRecording.val=this.navSessions.size>0;
    }

    private _syncPlayButton():void{
        this.ui.playing.val=this.isPlaying;
    }

    private _syncInputs(step?:RecorderSnapshotStep):void{
        const delay=step?.delay ?? this._capture.delay;
        const duration=step?.duration ?? this._capture.duration;
        if(this._delayInput){
            this._delayInput.value=String(delay);
            this._delayInput.title=step?this.t("stepDelayHint",{value:this._capture.delay}):this.t("defaultDelayHint");
        }
        if(this._durationInput){
            this._durationInput.value=String(duration);
            this._durationInput.title=step?this.t("stepDurationHint",{value:this._capture.duration}):this.t("defaultDurationHint");
        }
    }

    openDefaultsModal():void{
        const {div}=van.tags;
        // Values are read back off the created nodes on Apply — the modal is a
        // one-shot form, so there is no state worth keeping reactive here.
        let delayField!:HTMLInputElement, durationField!:HTMLInputElement;
        const numberField=(key:string,legend:string,value:number,min:string,ref:(el:HTMLInputElement)=>void)=>
            this._numberInput(`${this.id}-defaults-${key}`,legend,value,min,()=>{},ref,"100%");
        const toggle=(label:string,checked:boolean)=>{
            const node=new UI.Checkbox({label,checked}).create() as HTMLElement;
            return {node,field:node.querySelector("input") as HTMLInputElement};
        };

        const delayNode=numberField("delay",this.t("defaultDelay"),this._capture.delay,"0",el=>delayField=el);
        const durationNode=numberField("duration",this.t("defaultDuration"),this._capture.duration,"0.1",el=>durationField=el);
        const visualizationToggle=toggle(this.t("captureVisualization"),!!this.recorder.capturesVisualization);
        const annotationsToggle=toggle(this.t("captureAnnotations"),this.captureAnnotations);
        const smoothToggle=toggle(this.t("smoothPathOption"),this.smoothPath);

        let modal:InstanceType<typeof UI.Modal>;
        const footer=div({class:"flex w-full justify-end gap-2"},
            this._modalButton($.t("common.cancel"),"btn-ghost",()=>modal.close()),
            this._modalButton(this.t("apply"),"btn-primary",()=>{
                const delay=Number(delayField?.value);
                const duration=Number(durationField?.value);
                if(Number.isFinite(delay)&&delay>=0) this._capture.delay=delay;
                if(Number.isFinite(duration)&&duration>0) this._capture.duration=duration;
                this.recorder.setCapturesVisualization(visualizationToggle.field.checked);
                this.captureAnnotations=annotationsToggle.field.checked;
                this.smoothPath=smoothToggle.field.checked;
                this.setOption("smoothPath",this.smoothPath);
                if(this.selectedIndex===null) this._syncInputs();
                modal.close();
            }),
        );
        modal=new UI.Modal({
            id:`${this.id}-recorder-defaults-modal`,
            header:this.t("defaultsTitle"),
            body:div({class:"flex flex-col gap-4"},delayNode,durationNode,
                visualizationToggle.node,annotationsToggle.node,smoothToggle.node),
            footer,
        }).mount();
        modal.open();
    }

    private _ensureMeasureNode():HTMLSpanElement{
        if(this.measureNode&&this.measureNode.isConnected) return this.measureNode;
        const {span}=van.tags;
        // Playback cursor: the `left` offset is rewritten from a 20 Hz loop, so
        // it stays a plain style write on a node van created once.
        const node=span({id:"playback-timeline-measure",
            style:"position:absolute;top:0;bottom:0;left:0;width:2px;background:rgb(220 38 38);pointer-events:none;z-index:2;"}) as HTMLSpanElement;
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
        const viewerId=(node.dataset.group||"") as UniqueViewerId;
        const index=this._groupNodes(viewerId).indexOf(node);
        if(index<0) return;
        // Clicking a step focuses its lane (becomes the current/editing viewer).
        if(viewerId&&this.currentViewerId!==viewerId){this.currentViewerId=viewerId; this._refreshLaneChrome(); this._syncRecordingsButton(); this._refreshRecordingsModal();}
        this.recorder.goToIndex(index,viewerId);
        this._highlight(this.recorder.getStep(index,viewerId),index,viewerId);
    }

    clearSelection():void{
        this.selectedIndex=null;
        this.selectedViewerId=null;
        this.track.querySelectorAll<HTMLElement>("[data-id]").forEach(node=>node.classList.remove("outline","outline-2","outline-error"));
        this.oldHighlight=null;
        this._syncInputs();
    }

    setValue(key:keyof Params,value:number):void{
        if(!Number.isFinite(value)) return;
        const step=this.selectedIndex===null?undefined:this.recorder.getStep(this.selectedIndex,this.selectedViewerId??undefined);
        if(step&&this.selectedIndex!==null){
            step[key]=value;
            const node=this._findUIStep(this.selectedIndex,this.selectedViewerId??undefined);
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
        const child=this._findUIStep(index,this.selectedViewerId??undefined);
        if(!child) return;
        this.recorder.remove(index,this.selectedViewerId??undefined);
        child.remove();
        this.clearSelection();
    }
    /**
     * Trigger a bundle export through the IO pipeline. This fans the
     * recorder's `bundle-export` capability to whatever sinks the admin
     * has bound (e.g. github + file-download fallback). Annotations are
     * exported by the annotations module independently — `presenterSids`
     * already links each annotation to its recorder step(s), so a separate
     * fused file is no longer needed.
     */
    async export():Promise<void>{
        const io=(window as any).IO_PIPELINE;
        if(!io?.flushBundleExport){console.error("[recorder] IO pipeline not available."); return;}
        await io.flushBundleExport({ownerUid:"recorder"});
    }

    private _highlight(step:RecorderSnapshotStep|undefined,index:number,viewerId?:UniqueViewerId):void{
        this.oldHighlight?.classList.remove("outline","outline-2","outline-error");
        this.selectedIndex=index;
        this.selectedViewerId=(viewerId??(step?.viewerId as UniqueViewerId|undefined))??this.selectedViewerId;
        const node=step?(this.track.querySelector<StepNode>(`[data-id="${step.id}"]`)||null):this._findUIStep(index,viewerId);
        this.oldHighlight=node||null; if(!step||!node) return;
        node.classList.add("outline","outline-2","outline-error"); this._syncInputs(step);
    }

    private _resetAllUISteps():void{
        // Preserve the measure node (playback cursor) across rebuilds.
        const measure=this.measureNode; if(measure&&measure.parentElement===this.track) this.track.removeChild(measure);
        this.track.replaceChildren();
        this._laneStates.clear();
        if(measure) this.track.appendChild(measure);
        this._renderLanes();
        // One lane per viewer: render each viewer's active recording into its
        // own lane container. Hitting Play runs all of these in parallel, so the
        // lanes mirror playback and column-align by index.
        ((VIEWER_MANAGER.viewers||[]) as Viewer[]).filter(Boolean).forEach(viewer=>{
            this.recorder.getSteps(viewer.uniqueId).forEach(step=>this._addUIStepFrom(viewer.uniqueId,step,false));
        });
        // Reapply selection outline after a full rebuild.
        if(this.selectedIndex!==null&&this.selectedViewerId){
            const st=this.recorder.getStep(this.selectedIndex,this.selectedViewerId);
            const n=st?this.track.querySelector<StepNode>(`[data-id="${st.id}"]`):null;
            this.oldHighlight=n||null;
            n?.classList.add("outline","outline-2","outline-error");
        }
    }

    private _groupNodes(viewerId:UniqueViewerId):HTMLElement[]{
        return Array.from(this.track.querySelectorAll<HTMLElement>(`[data-lane="${viewerId}"] [data-id]`));
    }

    private _laneEl(viewerId:UniqueViewerId):HTMLElement|null{
        return this.track.querySelector<HTMLElement>(`[data-lane="${viewerId}"]`);
    }

    private _addUIStepFrom(viewerId:UniqueViewerId,step:RecorderSnapshotStep,withNav=true,atIndex?:number):void{
        const viewer=this._resolveViewerForStep(step)||(VIEWER_MANAGER.getViewer(viewerId,false) as Viewer|undefined); if(!viewer) return;
        const lane=this._laneEl(viewer.uniqueId); if(!lane) return;
        const {canvas,span}=van.tags;
        // Step chips are measured and resized imperatively (width=duration,
        // height=zoom, canvas repaint) on every timing edit, so van only builds
        // them — their geometry stays a direct style write. See _refreshStepNode.
        const props={id:`step-timeline-${step.id}`,draggable:true,class:"inline-block rounded-sm cursor-pointer align-top",
            style:"position:relative;z-index:1;","data-id":step.id,"data-group":viewer.uniqueId,
            onclick:(e:MouseEvent)=>this.selectPoint(e.currentTarget as HTMLElement),
            oncontextmenu:(e:MouseEvent)=>{e.preventDefault(); this._openOverlayEditor(step);},
            title:this.t("editOverlaysHint")};
        const node=(step.kind==="navigation"?canvas(props):span(props)) as StepNode;
        this._refreshStepNode(node,step,viewer);
        // Append into the viewer's own lane; ordering within a lane is DOM order
        // and each lane flows independently from x=0.
        if(typeof atIndex==="number"){const children=this._groupNodes(viewer.uniqueId); const before=children[atIndex]; if(before) lane.insertBefore(node,before); else lane.appendChild(node);} else lane.appendChild(node);
        if(withNav&&typeof atIndex==="number"){this.recorder.goToIndex(atIndex,viewer.uniqueId); this._highlight(step,atIndex,viewer.uniqueId);}
    }

    private _openOverlayEditor(step:RecorderSnapshotStep):void{
        new OverlayEditor(this.recorder,step,this.overlayRenderer).open();
    }

    private _refreshStepNode(node:StepNode,step:RecorderSnapshotStep,viewer?:Viewer):void{
        const v=viewer||VIEWER_MANAGER.getViewer(step.viewerId) as Viewer|undefined; if(!v) return;
        const size=this._getStepSize(step,v), ratio=Math.max(1,Math.floor(window.devicePixelRatio||1));
        node.style.width=`${size.width}px`; node.style.height=`${size.height}px`; node.style.marginLeft=`${size.marginLeft}px`; node.style.marginTop=`${size.marginTop}px`; node.style.borderBottomLeftRadius=`${size.radius}px`;
        if(step.kind==="empty"){
            // Spacer/hold: render as faint empty space (occupies width=duration).
            node.style.background="transparent";
            node.style.display="inline-block";
            node.style.border="1px dashed rgba(148,163,184,0.45)";
            node.style.borderBottomLeftRadius="0";
            return;
        }
        if(node instanceof HTMLCanvasElement){
            node.width=Math.max(1,Math.round(size.width*ratio)); node.height=Math.max(1,Math.round(size.height*ratio)); this._drawStepCanvas(node,step,size,ratio,v);
        }else{
            node.style.background=this._stepColor(step);
            node.style.display="inline-block";
            node.style.borderColor=this._stepColor(step);
        }
    }

    private _getStepSize(step:RecorderSnapshotStep,viewer:Viewer){
        const zoom=this._representativeZoom(step)??1;
        const maxHeight=Math.max(7,Math.log(viewer.viewport.getMaxZoom())/Math.log(viewer.viewport.getMaxZoom()+1)*18+14);
        const normalHeight=Math.max(7,Math.log(zoom)/Math.log(viewer.viewport.getMaxZoom()+1)*18+14);
        const height=step.kind==="navigation"?maxHeight:(step.kind==="empty"?Math.max(7,normalHeight*0.5):normalHeight);
        // Steps live inside their lane container now; centre vertically within it.
        const marginTop=Math.max(2,Math.floor((this._viewerRowHeight()-height)/2));
        return {width:this._durationWidth(step.duration),height,marginLeft:this._delayWidth(step.delay),marginTop,radius:this._metric("transition",step.transition)};
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
    private _findUIStep(index:number,viewerId?:UniqueViewerId):StepNode|undefined{const step=this.recorder.getStep(index,viewerId); return step?this.track.querySelector<StepNode>(`[data-id="${step.id}"]`)||undefined:undefined;}
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
        return raw&&raw.trim()?raw.trim():this.t("slideN",{index:index+1});
    }

    /**
     * Build one lane container per viewer (a block child of the track). Steps
     * are appended INTO their viewer's lane and flow inline from x=0, so step i
     * in every lane lands at the same x (given equal per-index timing) — i.e.
     * simultaneously-captured frames column-align. Does NOT add step nodes.
     */
    private _renderLanes():void{
        const {div,span,button}=van.tags;
        const viewers=((VIEWER_MANAGER.viewers||[]) as Viewer[]).filter(Boolean);
        const rowHeight=this._viewerRowHeight();
        this.track.style.minHeight=`${rowHeight*Math.max(1,viewers.length)}px`;
        const currentId=this._currentViewerId();
        viewers.forEach((viewer,index)=>{
            // Lane chrome (current tint, armed marker) is reactive: _refreshLaneChrome
            // only writes these two states and van repaints the bound attributes.
            const state={current:van.state(viewer.uniqueId===currentId),armed:van.state(this.armed.has(viewer.uniqueId))};
            this._laneStates.set(viewer.uniqueId,state);
            const fullLabel=this._viewerLabel(viewer,index);
            const lane=div({
                "data-lane":viewer.uniqueId,
                class:()=>`relative rounded-sm border ${state.current.val?"border-info":"border-base-300"}`,
                // paddingLeft leaves room for the arm toggle; it is equal across
                // lanes, so steps still column-align.
                style:()=>`height:${rowHeight}px;box-sizing:border-box;white-space:nowrap;width:max-content;min-width:100%;padding-left:30px;`
                    +`background-color:${state.current.val?"rgba(56,189,248,0.07)":"rgba(255,255,255,0.03)"};`
                    +`box-shadow:${state.armed.val?"inset 3px 0 0 rgb(220 38 38)":"none"};`,
            },
                // Record-arm toggle (explicit capture target, independent of hover).
                button({type:"button","data-lane-chrome":"true",
                    class:()=>`btn btn-ghost btn-xs btn-square absolute ${state.armed.val?"text-error":"opacity-50"}`,
                    style:"left:2px;top:2px;z-index:3;pointer-events:auto;",
                    title:()=>state.armed.val?this.t("disarmViewer"):this.t("armViewer"),
                    onclick:(event:MouseEvent)=>{event.stopPropagation(); this._toggleArm(viewer.uniqueId);},
                },span({class:()=>`ph-light ${state.armed.val?"ph-record":"ph-circle"}`})),
                span({"data-lane-chrome":"true",
                    class:"absolute right-2 bottom-1 text-xs uppercase opacity-60 bg-base-100 px-1 rounded",
                    style:"z-index:3;pointer-events:auto;cursor:pointer;",
                    title:this.t("makeCurrentHint",{label:fullLabel}),
                    onclick:(event:MouseEvent)=>{event.stopPropagation(); this._setCurrentViewer(viewer.uniqueId);},
                },this._shortLabel(fullLabel)),
            );
            this.track.appendChild(lane);
        });
    }

    /** Update lane tint / armed indicator in place (no step rebuild). */
    private _refreshLaneChrome():void{
        const currentId=this._currentViewerId();
        for(const [viewerId,state] of this._laneStates){
            state.current.val=viewerId===currentId;
            state.armed.val=this.armed.has(viewerId);
        }
    }

    private _toggleArm(viewerId:UniqueViewerId):void{
        if(this.armed.has(viewerId)) this.armed.delete(viewerId); else this.armed.add(viewerId);
        this._refreshLaneChrome();
    }

    private _getAnnotationsWrapper(viewerLike?:OpenSeadragon.Viewer):AnnWrap|null{
        const e=this.annotations; if(!e) return null; const viewer=viewerLike||this._getActiveViewer(); const c:Array<AnnWrap|undefined>=[];
        // Skip viewers with an empty world: the fabric wrapper cannot construct
        // without a tiled image (open failed / not finished) and probing it on
        // every retry sweep just spams warnings.
        const viewerUsable=!!viewer&&(viewer.world?.getItemCount?.()??0)>0;
        if(viewerUsable&&typeof e.getFabric==="function"){try{c.push(e.getFabric(viewer));}catch(error){console.warn("Recorder: failed to resolve annotations wrapper for viewer.",error);}}
        if(e.fabric&&"loadObjects" in e.fabric) c.push(e.fabric); if(e.wrapper) c.push(e.wrapper);
        // Candidate `canvas` getters may throw (half-initialized wrappers) — probe defensively.
        for(const cand of c){try{if(cand?.canvas) return cand;}catch(_e){/* skip broken candidate */}}
        return null;
    }

    private _getAnnotationsCanvas(viewerLike?:OpenSeadragon.Viewer):AnnCanvas|null{
        const wrapper=this._getAnnotationsWrapper(viewerLike);
        try{if(wrapper?.canvas&&typeof wrapper.canvas.forEachObject==="function") return wrapper.canvas;}catch(_e){/* broken wrapper canvas getter */}
        const e=this.annotations; if(!e) return null;
        const c=[]; try{c.push(e.canvas);}catch(_e){} try{c.push(e.fabric&&"canvas" in e.fabric?e.fabric.canvas:undefined);}catch(_e){} try{c.push(e.fabricCanvas);}catch(_e){}
        for(const cand of c) if(cand&&typeof cand.forEachObject==="function") return cand; return null;
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
            this.annotations=ctor.instance(); this.annotations.forceExportsProp="presenterSids";
            if(!this._bindAnnotations()){let retries=6; const retry=()=>{if(this._bindAnnotations()||--retries<=0) return; window.setTimeout(retry,150);}; window.setTimeout(retry,150);}
            const add=(o:AnnObj)=>o.presenterSids?.forEach(id=>this._recordAnnotationRef(o,id));
            this.annotations.addFabricHandler("annotation-create",(e)=>add(e.object));
            this.annotations.addFabricHandler("annotation-delete",(e)=>this._removeAnnotationRef(e.object));
            this.annotations.addFabricHandler("annotation-replace",(e)=>{this._removeAnnotationRef(e.previous); e.next.presenterSids=e.previous.presenterSids; add(e.next);});
        }catch(error){console.error(error);}
    }

    private _initEvents():void{
        this.recorder.addHandler("play",()=>{
            this.stopNavigationRecording(false);
            if(this.isPlaying) return; // fan-out fires `play` once per viewer
            this.isPlaying=true;
            this._syncPlayButton();
            this._clearMeasureLoop();
            this._ensureMeasureNode();
            this.measureReferenceStamp=Date.now();
            this.measureAbsoluteOffset=0;
            this.measureRealtimeOffset=0;
            this.measureDelayPhase=true;
        });
        this.recorder.addHandler("stop",()=>{
            if(this.recorder.isPlaying()) return; // other viewers still playing
            this.isPlaying=false;
            this._syncPlayButton();
            this._clearMeasureLoop();
        });

        this.recorder.addHandler("enter",(e:{viewerId?:UniqueViewerId;step:RecorderSnapshotStep;index:number;prevStep?:RecorderSnapshotStep})=>{
            const activeId=this._resolveActiveViewerId();
            const isActiveLane=!e.viewerId||!activeId||e.viewerId===activeId;
            // Outline the entered step in its own lane (all viewers play in
            // parallel); but only the active lane drives the single measure bar.
            this._highlight(e.step,e.index,e.viewerId);
            const currentNode=this.track.querySelector<StepNode>(`[data-id="${e.step.id}"]`)||undefined;
            if(this.isPlaying&&isActiveLane&&currentNode){
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
            // Each viewer's lane shows its own active recording; render the new
            // step into the lane it was captured in.
            this._addUIStepFrom(e.viewerId,e.step,false,e.index);
            this._highlight(e.step,e.index,e.viewerId);
        });
        this.recorder.addHandler("remove",(e:{step:RecorderSnapshotStep})=>{const refs=this.annotationRefs[e.step.id]; refs?.forEach(o=>{const i=o.presenterSids?.indexOf(e.step.id)??-1; if(i>=0) o.presenterSids!.splice(i,1);});});
        // A step's chip encodes its timing (width=duration, height=zoom), so any
        // edit — overlay editor, scripting API, undo — has to re-measure it.
        // Without this the chip keeps the size it had when it was captured.
        this.recorder.addHandler("update",(e:{viewerId?:UniqueViewerId;step?:RecorderSnapshotStep})=>{
            if(!e.step){this._resetAllUISteps(); return;} // whole-recording upsert
            const node=this.track.querySelector<StepNode>(`[data-id="${e.step.id}"]`);
            if(!node) return void this._resetAllUISteps();
            this._refreshStepNode(node,e.step,e.viewerId?VIEWER_MANAGER.getViewer(e.viewerId,false) as Viewer|undefined:undefined);
        });
        // Recording lifecycle / switch → refresh button label, modal list, timeline.
        const refreshRecordings=()=>{this._syncRecordingsButton(); this._refreshRecordingsModal(); this._resetAllUISteps();};
        this.recorder.addHandler("recording-create",refreshRecordings);
        this.recorder.addHandler("recording-delete",refreshRecordings);
        this.recorder.addHandler("recording-rename",()=>{this._syncRecordingsButton(); this._refreshRecordingsModal();});
        this.recorder.addHandler("recording-active",refreshRecordings);
        // NOTE: intentionally NOT bound to `active-viewer-changed` — the recorder's
        // current/armed viewers are explicit (lane click / arm toggle) and must not
        // follow hover/focus. We only react to viewers appearing/disappearing.
        VIEWER_MANAGER.addHandler("viewer-create",(e:any)=>{
            const id=(e?.uniqueId||e?.viewer?.uniqueId) as UniqueViewerId|undefined;
            if(id&&!this.currentViewerId) this.currentViewerId=id;
            if(this.armed.size===0){const cur=this._currentViewerId(); if(cur) this.armed.add(cur);}
            refreshRecordings();
        });
        VIEWER_MANAGER.addHandler("viewer-destroy",(e:any)=>{
            const id=(e?.uniqueId||e?.viewer?.uniqueId) as UniqueViewerId|undefined;
            if(id){
                this.armed.delete(id);
                const s=this.navSessions.get(id);
                if(s){const r=this._getRenderer(s.viewer); if(r&&s.visualizationHandler) r.removeHandler("visualization-change",s.visualizationHandler); this.navSessions.delete(id); this._syncRecordPathButton();}
                if(this.currentViewerId===id) this.currentViewerId=null; // reseeds on next read
            }
            refreshRecordings();
        });
        VIEWER_MANAGER.addHandler("viewer-reset",refreshRecordings);
        VIEWER_MANAGER.addHandler("module-loaded",(e:{id:string})=>{if(e.id==="annotations") this._handleInitAnnotationsModule();});
        VIEWER_MANAGER.addHandler("key-down",(e:KeyboardEvent&{focusCanvas?:boolean})=>{if(!e.focusCanvas) return; if(e.code==="KeyN") this.recorder.goToIndex(this.recorder.currentStepIndex()+1); else if(e.code==="KeyS") this.recorder.goToIndex(0);});
    }
}

addPlugin("recorder",RecorderPlugin);
