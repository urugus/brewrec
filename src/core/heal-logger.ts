const write = (msg: string): void => {
  process.stderr.write(msg);
};

export const logStepStart = (stepId: string, title: string): void => {
  write(`  [${stepId}] ${title}...`);
};

export const logStepOk = (): void => {
  write(" OK\n");
};

export const logStepFailed = (error: string): void => {
  write(" FAILED\n");
  write(`    -> ${error}\n`);
};

export const logHealPhase1Start = (): void => {
  write("    -> [自動修復] 代替セレクタを検索中...\n");
};

export const logHealPhase1Llm = (): void => {
  write("    -> [自動修復] Claudeに問い合わせ中...\n");
};

export const logHealPhase1Success = (strategy: string, selector: string): void => {
  write(`    -> [自動修復] 成功！ (${strategy})\n`);
  write(`      新セレクタ: ${selector}\n`);
};

export const logHealPhase1Failed = (): void => {
  write("    -> [自動修復] 代替セレクタが見つかりませんでした\n");
};

export const logHealPhase2Start = (title: string): void => {
  write(
    `\n    +------------------------------------------+\n    |  手動操作が必要です                        |\n    |                                            |\n    |  ステップ: ${title.padEnd(30)}|\n    |  ブラウザで操作を行ってください。           |\n    |  完了したら Enter を押してください。        |\n    +------------------------------------------+\n\n`,
  );
};

export const logHealPhase2Success = (newStepCount: number): void => {
  write(`    -> [手動修復] ${newStepCount}ステップを記録。レシピを更新して続行します。\n\n`);
};

export const logGuardSkipped = (expected: string, actual: string): void => {
  write("    -> [Guard修復] URL不一致ですがドメインは同じため続行します\n");
  write(`      期待: ${expected}\n`);
  write(`      実際: ${actual}\n`);
};

export const logRecipeSaved = (name: string, version: number): void => {
  write(`\n  レシピ "${name}" を v${version} に更新しました。\n`);
};

export const logHealSummary = (phase1Healed: number, phase2ReRecorded: number): void => {
  write(`  ヒーリングサマリー: ${phase1Healed}件自動修復, ${phase2ReRecorded}件手動再記録\n`);
};
