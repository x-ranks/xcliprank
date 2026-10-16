import { notFound } from "next/navigation";
import Panel from "./Panel";
export const dynamic="force-dynamic";
export const metadata={title:"選別投稿者の共通管理 | Xclip",robots:{index:false,follow:false}};
export default function Page(){if(process.env.NODE_ENV==="production")notFound();return <Panel/>;}
