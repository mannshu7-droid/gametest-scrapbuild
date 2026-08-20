/**
 * スプライト画像のプリロード・参照ユーティリティ。
 * 素材: Kenney.nl "Tiny Dungeon"（CC0ライセンス、著作権表示不要）を`public/sprites/`に格納し使用。
 * 画像は`public/`配下なのでVite開発・ビルドどちらでもルート相対パス`/sprites/xxx.png`で参照できる。
 * 読み込み中・失敗時はnullを返し、呼び出し側（renderer.ts）が単色フォールバック描画に切り替える。
 */
export type SpriteName =
  | 'player'
  | 'enemy_crawler'
  | 'enemy_brute'
  | 'tile_dirt'
  | 'tile_rock'
  | 'tile_floor'
  | 'tile_prop'
  | 'tile_outpost';

const SPRITE_FILES: Record<SpriteName, string> = {
  player: 'player.png',
  enemy_crawler: 'enemy_crawler.png',
  enemy_brute: 'enemy_brute.png',
  tile_dirt: 'tile_dirt.png',
  tile_rock: 'tile_rock.png',
  tile_floor: 'tile_floor.png',
  tile_prop: 'tile_prop.png',
  tile_outpost: 'tile_outpost.png',
};

const images: Partial<Record<SpriteName, HTMLImageElement>> = {};

for (const [name, file] of Object.entries(SPRITE_FILES) as [SpriteName, string][]) {
  // ブラウザ環境（Vite dev/build）以外、例えばNode専用のheadless/simulate.tsからは
  // このモジュールを読み込まないため、Image未定義環境を考慮する必要はない
  const img = new Image();
  img.src = `/sprites/${file}`;
  images[name] = img;
}

/** 読み込み完了済み（かつ有効な画像）ならHTMLImageElementを返す。未完了・失敗時はnull */
export function getSprite(name: SpriteName): HTMLImageElement | null {
  const img = images[name];
  return img && img.complete && img.naturalWidth > 0 ? img : null;
}
