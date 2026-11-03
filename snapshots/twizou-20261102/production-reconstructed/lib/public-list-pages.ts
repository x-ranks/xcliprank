export const browsePageCount = (count: number) => Math.max(1, Math.ceil(count / 100));
export const browseHref = (page: number) => page === 1 ? "/browse" : `/browse?page=${page}`;
export const accountPageCount = (count: number) => Math.max(1, Math.ceil(count / 40));
export const accountListHref = (page: number) => page === 1 ? "/accounts" : `/accounts?page=${page}`;
