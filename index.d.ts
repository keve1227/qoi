declare interface TypedArrayLike {
    buffer: ArrayBufferLike;
    byteOffset: number;
    byteLength: number;
}

export declare interface QOIEncodingOptions {
    width: number;
    height: number;
    channels?: 3 | 4;
    colorspace?: "srgb" | "linear";
}

export declare interface QOIDecodingOptions {
    channels?: 3 | 4;
}

export declare interface QOIImage {
    width: number;
    height: number;
    channels: 3 | 4;
    colorspace: "srgb" | "linear";
    data: Uint8Array;
}

export declare function encode(data: TypedArrayLike, options?: QOIEncodingOptions): Uint8Array;

export declare function decode(data: TypedArrayLike, options?: QOIDecodingOptions): QOIImage;
