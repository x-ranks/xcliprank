"use client";
import { useState, type ImgHTMLAttributes } from "react";
import { publicThumbnail } from "../../lib/public-thumbnail";
export default function PublicThumbnail({ src, alt, ...props }: Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "srcSet"> & { src: string; alt: string }) {
  const [failedFor, setFailedFor] = useState<string | null>(null);
  const image = failedFor === src ? { src } : publicThumbnail(src);
  return <img {...props} {...image} alt={alt} onError={event => {
    if (failedFor !== src && image.src !== src) setFailedFor(src);
    props.onError?.(event);
  }} />;
}
