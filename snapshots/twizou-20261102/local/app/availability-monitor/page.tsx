import { notFound } from "next/navigation";
import Panel from "./Panel";
export const dynamic="force-dynamic";
export const metadata={title:"再生不可動画の監視 | Xclip",robots:{index:false,follow:false}};
export default function Page(){if(process.env.NODE_ENV==="production")notFound();return <Panel/>;}
