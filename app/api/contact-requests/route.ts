import { createHash, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "../../../lib/cron-auth";
import { supabaseAdmin } from "../../../lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CATEGORIES = new Set(["advertising", "partnership", "technical", "other"]);
const STATUSES = new Set(["pending", "reviewing", "resolved", "closed"]);
const CONTACT_REQUEST_SELECT =
  "id,request_code,category,name,contact_email,subject,details,status,created_at,reviewed_at,review_note";
const recentRequests = new Map<string, number[]>();

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function rateLimitKey(request: NextRequest) {
  const forwarded =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  return createHash("sha256").update(forwarded).digest("hex");
}

function isRateLimited(key: string) {
  const now = Date.now();
  const cutoff = now - 60 * 60 * 1000;
  const active = (recentRequests.get(key) ?? []).filter((time) => time > cutoff);
  if (active.length >= 3) return true;
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
      .from("contact_requests")
      .select(CONTACT_REQUEST_SELECT)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw error;

    return NextResponse.json({ success: true, requests: data ?? [] });
  } catch (error) {
    console.error("Contact request list error:", error);
    return NextResponse.json(
      { success: false, error: "お問い合わせを取得できませんでした。" },
      { status: 500 }
    );
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
      return NextResponse.json(
        { success: false, error: "受付番号が正しくありません。" },
        { status: 400 }
      );
    }
    if (!STATUSES.has(status)) {
      return NextResponse.json(
        { success: false, error: "対応状況が正しくありません。" },
        { status: 400 }
      );
    }

    const finished = status === "resolved" || status === "closed";
    const { data, error } = await supabaseAdmin()
      .from("contact_requests")
      .update({
        status,
        review_note: reviewNote || null,
        reviewed_at: finished ? new Date().toISOString() : null,
      })
      .eq("request_code", requestCode)
      .select(CONTACT_REQUEST_SELECT)
      .single();
    if (error) throw error;

    return NextResponse.json({ success: true, request: data });
  } catch (error) {
    console.error("Contact request update error:", error);
    return NextResponse.json(
      { success: false, error: "対応状況を更新できませんでした。" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (cleanText(body.website, 100)) {
      return NextResponse.json({ success: true, requestCode: "received" });
    }
    if (body.confirmed !== "yes") {
      return NextResponse.json(
        { success: false, error: "確認項目に同意してください。" },
        { status: 400 }
      );
    }

    const category = cleanText(body.category, 40);
    const name = cleanText(body.name, 100);
    const contactEmail = cleanText(body.contactEmail, 254).toLowerCase();
    const subject = cleanText(body.subject, 120);
    const details = cleanText(body.details, 2000);

    if (!CATEGORIES.has(category)) {
      return NextResponse.json(
        { success: false, error: "お問い合わせ種別を選択してください。" },
        { status: 400 }
      );
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
      return NextResponse.json(
        { success: false, error: "メールアドレスを正しく入力してください。" },
        { status: 400 }
      );
    }
    if (subject.length < 3) {
      return NextResponse.json(
        { success: false, error: "件名を3文字以上で入力してください。" },
        { status: 400 }
      );
    }
    if (details.length < 20) {
      return NextResponse.json(
        { success: false, error: "お問い合わせ内容を20文字以上で入力してください。" },
        { status: 400 }
      );
    }

    const key = rateLimitKey(request);
    if (isRateLimited(key)) {
      return NextResponse.json(
        { success: false, error: "短時間の送信回数が多すぎます。時間をおいてお試しください。" },
        { status: 429 }
      );
    }

    const requestCode = randomUUID();
    const { error } = await supabaseAdmin().from("contact_requests").insert({
      request_code: requestCode,
      category,
      name: name || null,
      contact_email: contactEmail,
      subject,
      details,
      status: "pending",
    });
    if (error) throw error;

    return NextResponse.json({ success: true, requestCode });
  } catch (error) {
    console.error("Contact request error:", error);
    return NextResponse.json(
      { success: false, error: "現在送信できません。時間をおいてお試しください。" },
      { status: 500 }
    );
  }
}
