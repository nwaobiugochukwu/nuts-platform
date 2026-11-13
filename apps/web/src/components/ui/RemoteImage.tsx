import Image, { type ImageProps } from "next/image";

type RemoteImageProps = Omit<ImageProps, "alt"> & {
  alt: string;
  width?: number | `${number}`;
  height?: number | `${number}`;
};

/**
 * Uses Next's image component for externally hosted user and catalog images.
 * The remote source is left unoptimized because providers already return
 * transformed assets and arbitrary hosts are intentionally not allowlisted.
 * Sets crossOrigin="anonymous" to avoid third-party storage tracking blocks.
 */
export function RemoteImage(props: RemoteImageProps) {
  const {
    alt,
    fill,
    width,
    height,
    unoptimized = true,
    crossOrigin = "anonymous",
    ...imageProps
  } = props;

  if (fill) {
    return (
      <Image
        {...imageProps}
        alt={alt}
        fill
        unoptimized={unoptimized}
        crossOrigin={crossOrigin}
      />
    );
  }

  return (
    <Image
      {...imageProps}
      alt={alt}
      width={width ?? 640}
      height={height ?? 480}
      unoptimized={unoptimized}
      crossOrigin={crossOrigin}
    />
  );
}
