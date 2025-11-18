import { permanentRedirect } from "next/navigation";

export const runtime = "nodejs";
export const revalidate = 0;

export default async function BoardPage() {
  permanentRedirect('/board');
}
