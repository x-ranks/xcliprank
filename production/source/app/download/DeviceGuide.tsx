import Link from "next/link";

export type GuideStep = { title: string; body: string };
export type GuideFaq = { q: string; a: string };
export type DeviceGuideProps = {
  device: "iphone" | "android";
  heading: string;
  lead: string;
  browser: string;
  steps: GuideStep[];
  whereTitle: string;
  where: string[];
  faqs: GuideFaq[];
  official: { href: string; label: string };
};

// Guide-only landing page: the save form itself lives on /download, so there is one tool and no duplicate h1.
export default function DeviceGuide(props: DeviceGuideProps) {
  const other = props.device === "iphone" ? { href: "/download/android", label: "Androidで保存する方法" } : { href: "/download/iphone", label: "iPhoneで保存する方法" };
  return <main className="download-page device-guide-page">
    <nav className="ranking-page-nav download-site-nav" aria-label="サイトメニュー">
      <Link href="/">新着</Link>
      <Link href="/rising">急上昇</Link>
      <Link href="/ranking/daily">24時間</Link>
      <Link href="/reels">リール</Link>
      <Link href="/download" className="active">動画保存</Link>
    </nav>
    <h1>{props.heading}</h1>
    <p>{props.lead}</p>
    <p className="device-guide-cta"><Link href="/download" className="video-download-trigger">投稿URLを入力して保存する</Link></p>
    <div className="download-notice">
      <strong>権利者が保存を許可した動画のみ利用できます。</strong>
      <p>許可のない転載・再配布は禁止です。保存条件は<Link href="/download-policy">保存ポリシー</Link>をご確認ください。</p>
    </div>
    <section className="download-guide" aria-labelledby="device-steps-title">
      <section id="device-steps"><h2 id="device-steps-title">{props.browser}での保存手順</h2>
        <ol>{props.steps.map(step => <li key={step.title}><strong>{step.title}</strong><br />{step.body}</li>)}</ol>
      </section>
      <section id="device-where"><h2>{props.whereTitle}</h2>
        <ul>{props.where.map(item => <li key={item}>{item}</li>)}</ul>
        <a href={props.official.href} target="_blank" rel="noopener noreferrer">{props.official.label}</a>
      </section>
      <section id="device-faq"><h2>よくある質問</h2>
        <dl className="download-guide-issues">{props.faqs.map(faq => <div key={faq.q}><dt>{faq.q}</dt><dd>{faq.a}</dd></div>)}</dl>
      </section>
      <section id="device-next"><h2>保存したい動画を探す</h2>
        <p>保存する動画が決まっていない場合は、<Link href="/rising">急上昇ランキング</Link>、<Link href="/ranking/daily">24時間ランキング</Link>、<Link href="/months">月別ランキング</Link>から探せます。気になる動画は★で保存リストに入れておくと、あとから<Link href="/favorites">保存リスト</Link>で見返せます。</p>
        <p><Link href={other.href}>{other.label}</Link> ／ <Link href="/download">端末共通の保存手順と、保存できないとき</Link></p>
      </section>
    </section>
  </main>;
}
