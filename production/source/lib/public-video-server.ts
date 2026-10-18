import { cache } from "react";
import { productionPublicBackend } from "./public-video-production";
export const readPublicDetail = cache((id: string) => productionPublicBackend().service.detail(id));
export const readPublicAccount = cache((key: string) => productionPublicBackend().service.account(key));
export const readPublicTag = cache((name: string) => productionPublicBackend().service.tag(name));
export const readPublicIndex = cache(() => productionPublicBackend().service.indexable());
