type ImageLike =
    | string
    | HTMLImageElement
    | CanvasRenderingContext2D
    | HTMLCanvasElement
    | Blob;

type MaybePromise<T> = T | Promise<T>;
