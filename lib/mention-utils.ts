/**
 * Mention Utilities
 * エディタ非依存のメンション変換ユーティリティ
 * TipTap・BlockNote等のエディタと共通で利用可能
 */

/**
 * メンショントークンの正規表現
 * <@id> 形式にマッチ（idは英数字、ハイフン、アンダースコアのみ）
 */
export const MENTION_REGEX = /<@([a-zA-Z0-9_-]+)>/g;

/**
 * 名前解決関数の型定義
 */
export type ResolveName = (id: string) => string | undefined;

/**
 * Mentionノードの型定義（TipTap/BlockNote共通）
 */
export interface MentionNode {
  type: 'mention';
  attrs: {
    id: string;
    name: string;
  };
}

/**
 * テキストノードの型定義
 */
export interface TextNode {
  type: 'text';
  text: string;
}

/**
 * 段落ノードの型定義
 */
export interface ParagraphNode {
  type: 'paragraph';
  content?: Array<MentionNode | TextNode>;
}

/**
 * ドキュメントルートの型定義
 */
export interface DocNode {
  type: 'doc';
  content: Array<ParagraphNode>;
}

/**
 * ストレージ形式（<@id>を含む生テキスト）からドキュメントJSONへ変換
 * @param raw - <@id>を含む生テキスト
 * @param resolveName - ID→表示名の解決関数
 * @returns TipTap/ProseMirror互換のドキュメントJSON
 */
export function fromStorage(raw: string, resolveName: ResolveName): DocNode {
  const lines = raw.split('\n');
  const content: ParagraphNode[] = [];

  for (const line of lines) {
    const nodes: Array<MentionNode | TextNode> = [];
    let lastIndex = 0;

    // 各行内の <@id> を検索
    const regex = new RegExp(MENTION_REGEX);
    let match: RegExpExecArray | null;

    while ((match = regex.exec(line)) !== null) {
      const [fullMatch, id] = match;
      const matchStart = match.index;

      // マッチ前のテキストを追加
      if (matchStart > lastIndex) {
        const textBefore = line.slice(lastIndex, matchStart);
        if (textBefore) {
          nodes.push({ type: 'text', text: textBefore });
        }
      }

      // Mentionノードを追加（名前解決、失敗時はidをそのまま使用）
      const name = resolveName(id) ?? id;
      nodes.push({
        type: 'mention',
        attrs: { id, name },
      });

      lastIndex = regex.lastIndex;
    }

    // マッチ後の残りテキストを追加
    if (lastIndex < line.length) {
      const textAfter = line.slice(lastIndex);
      if (textAfter) {
        nodes.push({ type: 'text', text: textAfter });
      }
    }

    // 空行でもparagraphとして追加
    content.push({
      type: 'paragraph',
      content: nodes.length > 0 ? nodes : undefined,
    });
  }

  return {
    type: 'doc',
    content,
  };
}

/**
 * ドキュメントJSONからストレージ形式（<@id>のみ）へ変換
 * @param doc - TipTap/ProseMirror互換のドキュメントJSON
 * @returns <@id>形式の生テキスト
 */
export function toStorage(doc: DocNode): string {
  const lines: string[] = [];

  for (const paragraph of doc.content) {
    const textParts: string[] = [];

    if (paragraph.content) {
      for (const node of paragraph.content) {
        if (node.type === 'mention') {
          // Mentionノードは <@id> に変換
          textParts.push(`<@${node.attrs.id}>`);
        } else if (node.type === 'text') {
          // テキストノードはそのまま
          textParts.push(node.text);
        }
      }
    }

    lines.push(textParts.join(''));
  }

  return lines.join('\n');
}

/**
 * プレーンテキスト内の <@id> をMentionノード配列に置き換え
 * （クリップボードペースト時などに使用）
 * @param text - <@id>を含む可能性のあるプレーンテキスト
 * @param resolveName - ID→表示名の解決関数
 * @returns Mention/Textノードの配列
 */
export function replaceTokensInPlainText(
  text: string,
  resolveName: ResolveName
): Array<MentionNode | TextNode> {
  const nodes: Array<MentionNode | TextNode> = [];
  let lastIndex = 0;

  const regex = new RegExp(MENTION_REGEX);
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const [fullMatch, id] = match;
    const matchStart = match.index;

    // マッチ前のテキストを追加
    if (matchStart > lastIndex) {
      const textBefore = text.slice(lastIndex, matchStart);
      if (textBefore) {
        nodes.push({ type: 'text', text: textBefore });
      }
    }

    // Mentionノードを追加
    const name = resolveName(id) ?? id;
    nodes.push({
      type: 'mention',
      attrs: { id, name },
    });

    lastIndex = regex.lastIndex;
  }

  // マッチ後の残りテキストを追加
  if (lastIndex < text.length) {
    const textAfter = text.slice(lastIndex);
    if (textAfter) {
      nodes.push({ type: 'text', text: textAfter });
    }
  }

  return nodes;
}

/**
 * プロフィールキャッシュ（クライアントサイド）
 * ID → 表示名のマップ
 */
const profileCache = new Map<string, string>();

/**
 * キャッシュに名前を追加/更新
 * @param id - ユーザーID
 * @param name - 表示名
 */
export function cacheProfileName(id: string, name: string): void {
  profileCache.set(id, name);
}

/**
 * キャッシュから名前を取得
 * @param id - ユーザーID
 * @returns 表示名（キャッシュにない場合はundefined）
 */
export function getCachedProfileName(id: string): string | undefined {
  return profileCache.get(id);
}

/**
 * キャッシュをクリア（テスト用）
 */
export function clearProfileCache(): void {
  profileCache.clear();
}

/**
 * 複数のプロフィールをキャッシュに一括登録
 * @param profiles - { id, name }の配列
 */
export function cacheProfiles(profiles: Array<{ id: string; name: string }>): void {
  for (const profile of profiles) {
    cacheProfileName(profile.id, profile.name);
  }
}
