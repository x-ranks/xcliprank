import { notFound, redirect } from "next/navigation";
export const dynamic="force-dynamic";
export default function Page(){if(process.env.NODE_ENV==="production")notFound();redirect("/curated-manager");}
