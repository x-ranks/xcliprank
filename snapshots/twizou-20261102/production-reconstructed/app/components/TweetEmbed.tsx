"use client";

import { useEffect, useRef } from "react";

declare global {
  interface Window {
    twttr?: {
      widgets?: {
        createTweet: (
          id: string,
          element: HTMLElement,
          options?: Record<string, unknown>
        ) => Promise<HTMLElement | undefined>;
      };
    };
  }
}

export default function TweetEmbed({ postId }: { postId: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    async function renderTweet() {
      if (!ref.current) return;

      if (!document.getElementById("x-widgets-js")) {
        const script = document.createElement("script");
        script.id = "x-widgets-js";
        script.src = "https://platform.twitter.com/widgets.js";
        script.async = true;
        document.body.appendChild(script);

        await new Promise<void>((resolve) => {
          script.onload = () => resolve();
          setTimeout(resolve, 2500);
        });
      }

      // Wait briefly for twttr.widgets to initialize.
      for (let i = 0; i < 25; i++) {
        if (window.twttr?.widgets?.createTweet) break;
        await new Promise((r) => setTimeout(r, 100));
      }

      if (cancelled || !ref.current || !window.twttr?.widgets?.createTweet) return;

      ref.current.innerHTML = "";
      await window.twttr.widgets.createTweet(postId, ref.current, {
        theme: "dark",
        align: "center",
        dnt: true
      });
    }

    renderTweet();
    return () => {
      cancelled = true;
    };
  }, [postId]);

  return <div className="tweet-embed" ref={ref} />;
}
