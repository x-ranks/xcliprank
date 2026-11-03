"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { startLearningLoop } from "../../lib/personal-learning-poll";

export default function PersonalLearningWorker() {
  const [message, setMessage] = useState("共通学習の状態を確認中");
  useEffect(() => {
    if (!["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)) return;
    return startLearningLoop({
      // step already checks current enabled state, ownership and model validity on the server.
      // Avoid GET's full model/status payload before every step.
      step: async () => {
        const response = await fetch("/api/tier-personal-model", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "step" }), cache: "no-store"
        });
        const result = await response.json();
        if (!response.ok) throw Error(result.error ?? "学習処理に失敗しました");
        if (!result || typeof result !== "object" || Array.isArray(result)) throw Error("学習処理の応答を確認できません");
        return result;
      },
      message: setMessage,
      locks: navigator.locks,
      wake: listener => {
        const channel = typeof BroadcastChannel === "undefined" ? undefined
          : new BroadcastChannel("xclip-personal-learning-wake-v1");
        const wake = () => { listener(); channel?.postMessage("wake"); };
        channel?.addEventListener("message", listener);
        window.addEventListener("xclip-personal-learning-wake", wake);
        return () => {
          window.removeEventListener("xclip-personal-learning-wake", wake);
          channel?.removeEventListener("message", listener); channel?.close();
        };
      }
    });
  }, []);
  return <p style={{ fontSize: 13, padding: "8px 0" }} role="status">
    <Link href="/tier-personal-model">共通Tier学習</Link>：{message}
  </p>;
}
