export interface BaseUIOptions {
    id?: string;
    extraClasses?: Record<string, string> | string;
    extraProperties?: Record<string, string>;
}

export type UIElement =
    | Node
    | BaseComponent
    | string
    | undefined
    | null;

export interface UINamedItem {
    id?: string;
    icon?: string;
    title?: string;
    body?: UIElement;
}

export type UINamedItemGetter<TArg = any> = (argument: TArg) => UINamedItem;

type ClassMap = Record<string, string>;
type PropertiesMap = Record<string, string>;
type VanStateLike<T> = { val: T };

type LayoutChangeDetail = any;

type AttachTarget =
    | BaseComponent
    | string
    | Element
    | HTMLElement;

export class BaseComponent<TOptions extends BaseUIOptions = BaseUIOptions> {
    id: string;
    options: TOptions;

    classMap: Record<string, string>;
    propertiesMap: Record<string, string>;
    propertiesStateMap: Record<string, VanStateLike<string>>;
    classState: VanStateLike<string>;

    _children: UIElement[];
    _renderedChildren: Node[] | null;

    onLayoutChange?: (detail: LayoutChangeDetail) => void;

    constructor(options?: TOptions | UIElement, ...children: UIElement[]);

    attachTo(element: AttachTarget): this;
    prependedTo(element: AttachTarget): this;
    removeFrom(element: BaseComponent | string | Element): boolean;

    refreshClassState(): void;
    refreshPropertiesState(): void;

    set(...properties: Array<(this: this) => void>): void;
    addChildren(...children: UIElement[]): void;

    get children(): Node[];
    get commonProperties(): { id?: string; class: VanStateLike<string> };
    get extraProperties(): Record<string, VanStateLike<string>>;

    setClass(key: string, value: string): void;
    toggleClass(key: string, value: string, on?: boolean): void;
    setExtraProperty(key: string, value: string): void;

    create(): Node;

    toNode(item: UIElement, reinit?: boolean): Node | undefined;

    static toNode(item: UIElement, reinit?: boolean): Node | undefined;

    static parseDomLikeItem(
        item: any,
        reinit?: boolean
    ): Node | Node[] | string | string[] | any[];

    static ensureTaggedAsExternalComponent(
        element: UIElement,
        componentId: XOpatElementID,
        instantiateString?: boolean
    ): UIElement;

    remove(): void;

    _applyOptions(options: Record<string, any>, ...names: string[]): void;
}

export interface SelectableUIOptions extends BaseUIOptions {
    itemID?: string | false;
}

export class BaseSelectableComponent<
    TOptions extends SelectableUIOptions = SelectableUIOptions
> extends BaseComponent<TOptions> {
    itemID: string | false;

    constructor(options?: TOptions | UIElement, ...args: UIElement[]);
    setSelected(itemID: string | false): void;
}