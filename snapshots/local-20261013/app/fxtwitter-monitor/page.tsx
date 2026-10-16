import { notFound } from "next/navigation";
import MonitorPanel from "./MonitorPanel";
export const dynamic="force-dynamic";
export const metadata={title:"選別投稿者の巡回管理 | Xclip",robots:{index:false,follow:false}};
export default function Page(){if(process.env.NODE_ENV==="production")notFound();return <MonitorPanel/>;}
