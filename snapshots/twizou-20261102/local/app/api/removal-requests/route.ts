import { createHash, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "../../../lib/cron-auth";
import { supabaseAdmin } from "../../../lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REASONS = new Set(["illegal", "minor", "nonconsensual", "copyright", "other"]);
const STATUSES = new Set(["pending", "reviewing", "removed", "rejected"]);
const REMOVAL_REQUEST_SELECT = "id,request_code,reported_url,x_post_id,reason,details,contact_email,status,created_at,reviewed_at,review_note";
const recentRequests = new Map<string, number[]>();

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function parseXPostUrl(value: unknown) {
  const raw = cleanText(value, 300);
  try {
    const url = new URL(raw);
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    if (hostname !== "x.com" && hostname !== "twitter.com") return null;
    const match = url.pathname.match(/^\/[A-Za-z0-9_]{1,15}\/status\/(\d+)/);
    if (!match) return null;
    return { url: `https://x.com${url.pathname}`, xPostId: match[1] };
  } catch {
    return null;
  }
}

function rateLimitKey(request: NextRequest) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  return createHash("sha256").update(forwarded).digest("hex");
}

function isRateLimited(key: string) {
  const now = Date.now();
  const cutoff = now - 60 * 60 * 1000;
  const active = (recentRequests.get(key) ?? []).filter((time) => time > cutoff);
  if (active.length >= 5) return true;
  active.push(now);
  recentRequests.set(key, active);
  return false;
}

export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { data, error } = await supabaseAdmin()
      .from("removal_requests")
      .select(REMOVAL_REQUEST_SELECT)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw error;

    const requests = data ?? [];
    const counts = {
      total: requests.length,
      pending: requests.filter((item) => item.status === "pending").length,
      reviewing: requests.filter((item) => item.status === "reviewing").length,
      removed: requests.filter((item) => item.status === "removed").length,
      rejected: requests.filter((item) => item.status === "rejected").length,
    };
    return NextResponse.json({ success: true, requests, counts });
  } catch (error) {
    console.error("Removal request list error:", error);
    return NextResponse.json({ success: false, error: "削除要請を取得できませんでした。" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const requestCode = cleanText(body.requestCode, 50);
    const status = cleanText(body.status, 20);
    const reviewNote = cleanText(body.reviewNote, 1000);
    if (!/^[0-9a-f-]{36}$/i.test(requestCode)) {
      return NextResponse.json({ success: false, error: "申請番号が正しくありません。" }, { status: 400 });
    }
    if (!STATUSES.has(status)) {
      return NextResponse.json({ success: false, error: "対応状況が正しくありません。" }, { status: 400 });
    }

    const finished = status === "removed" || status === "rejected";
    const { data, error } = await supabaseAdmin()
      .from("removal_requests")
      .update({
        status,
        review_note: reviewNote || null,
        reviewed_at: finished ? new Date().toISOString() : null,
      })
      .eq("request_code", requestCode)
      .select(REMOVAL_REQUEST_SELECT)
      .single();
    if (error) throw error;

    return NextResponse.json({ success: true, request: data });
  } catch (error) {
    console.error("Removal request update error:", error);
    return NextResponse.json({ success: false, error: "対応状況を更新できませんでした。" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (cleanText(body.website, 100)) {
      return NextResponse.json({ success: true, requestCode: "received" });
    }
    if (body.confirmed !== "yes") {
      return NextResponse.json({ success: false, error: "確認項目に同意してください。" }, { status: 400 });
    }

    const post = parseXPostUrl(body.reportedUrl);
    const reason = cleanText(body.reason, 40);
    const details = cleanText(body.details, 1500);
    const contactEmail = cleanText(body.contactEmail, 254).toLowerCase();
    if (!post) return NextResponse.json({ success: false, error: "X投稿URLを正しく入力してください。" }, { status: 400 });
    if (!REASONS.has(reason)) return NextResponse.json({ success: false, error: "削除理由を選択してください。" }, { status: 400 });
    if (details.length < 20) return NextResponse.json({ success: false, error: "詳細を20文字以上で入力してください。" }, { status: 400 });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
      return NextResponse.json({ success: false, error: "メールアドレスを正しく入力してください。" }, { status: 400 });
    }

    const key = rateLimitKey(request);
    if (isRateLimited(key)) {
      return NextResponse.json({ success: false, error: "短時間の送信回数が多すぎます。時間をおいてお試しください。" }, { status: 429 });
    }

    const requestCode = randomUUID();
    const { error } = await supabaseAdmin().from("removal_requests").insert({
      request_code: requestCode,
      reported_url: post.url,
      x_post_id: post.xPostId,
      reason,
      details,
      contact_email: contactEmail,
      status: "pending",
    });
    if (error) throw error;

    return NextResponse.json({ success: true, requestCode });
  } catch (error) {
    console.error("Removal request error:", error);
    return NextResponse.json({ success: false, error: "現在送信できません。時間をおいてお試しください。" }, { status: 500 });
  }
}
