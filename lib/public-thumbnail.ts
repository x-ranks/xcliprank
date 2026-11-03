export function publicThumbnail(raw: string) {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.hostname !== "pbs.twimg.com" || url.username || url.password || url.port ||
        !/^\/(?:media\/|(?:amplify_video|ext_tw_video|tweet_video)_thumb\/)/.test(url.pathname) ||
        !/\.(?:jpg|jpeg|png|webp)$/.test(url.pathname) && !["jpg", "jpeg", "png", "webp"].includes(url.searchParams.get("format") ?? "") ||
        [...url.searchParams.keys()].some(key => !["format", "name"].includes(key))) return { src: raw };
    url.searchParams.set("name", "small"); const small = url.toString();
    url.searchParams.set("name", "medium");
    return { src: small, srcSet: `${small} 1x, ${url.toString()} 2x` };
  } catch { return { src: raw }; }
}
