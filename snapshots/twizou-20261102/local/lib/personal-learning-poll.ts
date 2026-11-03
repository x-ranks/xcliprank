export type LearningStep = Record<string, unknown>;
type Timer = ReturnType<typeof setTimeout>;
export type LearningLoopOptions = {
  step: () => Promise<LearningStep>;
  message: (text: string) => void;
  locks?: Pick<LockManager, "request">;
  wake: (listener: () => void) => () => void;
  schedule?: typeof setTimeout;
  cancel?: typeof clearTimeout;
};

export function learningMessage(p: LearningStep) {
  return p.paused ? "共通学習は停止中です"
    : p.newVideoProcessed ? "新規動画を採用モデルで評価しました"
    : p.newVideosIdle ? "新規動画の評価待ち（確認間隔を延ばしています）"
    : p.newVideosPaused ? "新規動画の自動評価は停止中"
    : p.preparing ? `保存済み動画の4フレーム準備：${p.processed}件処理済み`
    : p.preparationDone ? "保存済み動画の準備が完了しました"
    : p.remaining ? `教師動画の4フレームを準備中：残り約${p.remaining}件`
    : p.busy ? "別の処理が終わるまで共通学習を待機しています"
    : p.finished ? "共通学習の検証が完了しました"
    : "共通学習は有効です";
}

// No model/state cache: every actual step retains the server's current DB guards.
export function startLearningLoop(options: LearningLoopOptions) {
  const schedule = options.schedule ?? setTimeout;
  const cancel = options.cancel ?? clearTimeout;
  let stopped = false, leader = false, running = false, requested = false, idle = 0;
  let timer: Timer | undefined;
  let release: (() => void) | undefined;
  const clear = () => { if (timer !== undefined) cancel(timer); timer = undefined; };
  const later = (callback: () => void, delay: number) => {
    clear(); if (!stopped) timer = schedule(callback, delay);
  };

  async function tick() {
    if (stopped || !leader || running) return;
    running = true;
    let delay = 5000;
    try {
      const p = await options.step();
      if (stopped) return;
      options.message(learningMessage(p));
      if (p.paused || p.newVideosPaused) { idle = 0; delay = 300000; }
      else if (p.busy) { idle = 0; delay = 30000; }
      else if (p.newVideosIdle || p.finished || p.preparationDone) {
        delay = [30000, 60000, 120000, 300000][Math.min(idle++, 3)];
      } else {
        idle = 0;
        if (p.remaining || p.preparing) delay = 1500;
      }
    } catch (error) {
      if (!stopped) options.message(error instanceof Error ? error.message : "共通学習を確認できません");
      idle = 0; delay = 30000;
    } finally {
      running = false;
      if (stopped) release?.();
      else {
        if (requested) { requested = false; idle = 0; delay = 0; }
        later(() => { void tick(); }, delay);
      }
    }
  }

  async function acquire() {
    if (stopped) return;
    if (!options.locks) { leader = true; void tick(); return; }
    try {
      // Hold one origin-wide lock for this component's lifetime. Followers do no HTTP.
      await options.locks.request("xclip-personal-learning-v1", { ifAvailable: true }, async lock => {
        if (!lock || stopped) return;
        leader = true;
        await new Promise<void>(resolve => { release = resolve; void tick(); });
        leader = false; release = undefined;
      });
      if (!stopped) {
        options.message("別の管理画面で共通学習を実行中です");
        later(() => { void acquire(); }, 15000);
      }
    } catch {
      // Do not start a second worker when browser locking fails.
      if (!stopped) {
        options.message("共通学習の同時実行確認に失敗しました。再確認します");
        later(() => { void acquire(); }, 30000);
      }
    }
  }

  const unlisten = options.wake(() => {
    if (stopped || !leader) return;
    idle = 0;
    if (running) requested = true;
    else { clear(); void tick(); }
  });
  void acquire();
  return () => {
    stopped = true; clear(); unlisten();
    // Keep the browser lock until an in-flight request settles. The DB lease remains authoritative.
    if (!running) release?.();
  };
}
