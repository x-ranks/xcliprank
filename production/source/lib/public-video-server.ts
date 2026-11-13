import { cache } from "react";
import { productionPublicBackend } from "./public-video-production";
const renderBackend = cache(() => productionPublicBackend({ readOnlyRender: true }));
export const readPublicDetail = cache((id: string) => renderBackend().service.detail(id));
export const readPublicDetailCore = cache((id: string) => renderBackend().service.detailCore(id));
export const readPublicRelated = cache(async (id: string) => {
  const core = await readPublicDetailCore(id);
  return core ? renderBackend().service.detailRelated(core) : null;
});
export const readPublicAccount = cache((key: string, page = 1) => renderBackend().service.account(key, page));
export const readPublicTag = cache((name: string, page = 1) => renderBackend().service.tag(name, page));
export const readPublicLabels = cache(() => renderBackend().service.activeLabels());
export const readPublicMonths = cache(() => renderBackend().service.months());
export const readPublicMonth = cache((month: string) => renderBackend().service.month(month));
export const readPublicIndex = cache(() => renderBackend().service.indexable());

export const readPublicBrowse = cache((page = 1) => renderBackend().service.browse(page));
