import SiteBrand from "../components/SiteBrand";
export default function Loading() {
  return <main aria-busy="true"><SiteBrand active="rising" /><p role="status" style={{ minHeight: 120 }}>ページを読み込んでいます…</p></main>;
}
