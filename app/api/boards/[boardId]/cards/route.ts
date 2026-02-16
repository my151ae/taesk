import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase';
import {
  getBoardMembership,
  hasAnyRole,
  requireAuthenticatedUser,
  validateMutationRequestOrigin,
} from '@/lib/server/api-security';
import { z } from 'zod';
import { generateShortId, slugify } from '@/lib/card-utils';
import { clampChecklist, EMPTY_CHECKLIST } from '@/lib/checklist';
import { buildContentFromTitle, deriveExcerptFromContent, ensureTitleBlock, normalizeContent, extractTitleTask } from '@/lib/tiptap';

const CreateCardSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().max(255),
  checklist: z.any().optional(),
  content: z.record(z.string(), z.unknown()).or(z.array(z.unknown())).optional(),
  excerpt: z.string().max(500).optional(),
  list_id: z.string().uuid().optional(),
  position: z.number().int().min(0).optional(),
  tags: z.array(z.string()).optional(),
  due_date: z.string().datetime().nullable().optional(),
  due_start: z.string().nullable().optional(),
  due_end: z.string().nullable().optional(),
  start_reminder_enabled: z.boolean().optional(),
  start_reminder_minutes: z.union([
    z.literal(0),
    z.literal(5),
    z.literal(10),
    z.literal(15),
    z.literal(30),
    z.literal(60),
  ]).optional(),
  end_reminder_enabled: z.boolean().optional(),
  end_reminder_minutes: z.union([
    z.literal(0),
    z.literal(5),
    z.literal(10),
    z.literal(15),
    z.literal(30),
    z.literal(60),
  ]).optional(),
  due_bucket: z.enum(['a', 'b']).nullable().optional(),
  due_bucket_position: z.number().nullable().optional(),
  priority: z.enum(['low', 'medium', 'high']).nullable().optional(),
  checked: z.boolean().optional(),
  assignee_id: z.string().uuid().nullable().optional(),
  assigned_to: z.string().nullable().optional(),
  user_id: z.string().uuid().nullable().optional(),
  short_id: z.string().nullable().optional(),
  id_short: z.number().int().min(0).nullable().optional(),
  slug: z.string().nullable().optional(),
  created_at: z.string().datetime().optional(),
  updated_at: z.string().datetime().optional(),
  duration: z.number().int().min(0).nullable().optional(),
});

/**
 * POST /api/boards/[boardId]/cards
 *
 * Create a new card.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ boardId: string }> }
) {
  try {
    const originError = validateMutationRequestOrigin(request);
    if (originError) {
      return originError;
    }

    const { boardId } = await params;
    const supabase = await createServerSupabaseClient();

    const { user, errorResponse } = await requireAuthenticatedUser(supabase);
    if (errorResponse || !user) {
      return errorResponse ?? NextResponse.json(
        { error: { code: 'UNAUTHENTICATED', message: 'Login required' } },
        { status: 401 }
      );
    }

    const membership = await getBoardMembership(supabase, boardId, user.id);

    if (!membership || !hasAnyRole(membership.role, ['owner', 'editor'])) {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } },
        { status: 403 }
      );
    }

    const body = await request.json();
    const parsed = CreateCardSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: 'INVALID_BODY',
            message: 'Validation failed',
            details: parsed.error.flatten(),
          },
        },
        { status: 422 }
      );
    }

    let listId = parsed.data.list_id;
    let position = parsed.data.position;

    if (!listId) {
      // Fetch the first list or create one
      const { data: lists } = await supabase
        .from('lists')
        .select('id')
        .eq('board_id', boardId)
        .order('position', { ascending: true })
        .limit(1);

      if (lists && lists.length > 0) {
        listId = lists[0].id;
      } else {
        // Create a default list
        const { data: newList, error: listError } = await supabase
          .from('lists')
          .insert({ board_id: boardId, title: 'To Do', position: 0 })
          .select('id')
          .single();

        if (listError || !newList) {
          throw new Error('Failed to create default list');
        }
        listId = newList.id;
      }
    }

    if (position === undefined) {
      // Get max position in the list
      const { data: maxPosData } = await supabase
        .from('cards')
        .select('position')
        .eq('list_id', listId)
        .order('position', { ascending: false })
        .limit(1);

      const maxPos = maxPosData?.[0]?.position ?? -1;
      position = maxPos + 1000; // Add gap
    }

    let shortId = parsed.data.short_id;
    if (!shortId) {
      shortId = generateShortId();
      // Simple collision check could be added here if needed
    }

    let idShort = parsed.data.id_short;
    if (idShort === undefined || idShort === null) {
      const { data: maxIdShortData } = await supabase
        .from('cards')
        .select('id_short')
        .eq('board_id', boardId)
        .order('id_short', { ascending: false })
        .limit(1);

      idShort = (maxIdShortData?.[0]?.id_short ?? 0) + 1;
    }

    let slug = parsed.data.slug;
    if (!slug) {
      slug = slugify(parsed.data.title);
    }

    const normalizedContent =
      parsed.data.content
        ? normalizeContent(parsed.data.content)
        : buildContentFromTitle(parsed.data.title);

    // content が明示的に渡された場合は content から title/checked を派生
    let derivedTitle = parsed.data.title;
    let derivedChecked = parsed.data.checked ?? false;
    if (parsed.data.content) {
      const extracted = extractTitleTask(normalizedContent);
      if (extracted.text) {
        derivedTitle = extracted.text;
        derivedChecked = extracted.checked;
      }
    }

    const normalizedExcerpt =
      typeof parsed.data.excerpt === 'string'
        ? parsed.data.excerpt
        : deriveExcerptFromContent(normalizedContent);

    const payload: Record<string, unknown> = {
      board_id: boardId,
      id: parsed.data.id,
      title: derivedTitle,
      checklist: clampChecklist(parsed.data.checklist ?? EMPTY_CHECKLIST),
      content: normalizedContent,
      excerpt: normalizedExcerpt,
      list_id: listId,
      position: position,
      tags: parsed.data.tags ?? [],
      due_date: parsed.data.due_date ?? null,
      due_start: parsed.data.due_start ?? null,
      due_end: parsed.data.due_end ?? null,
      start_reminder_enabled: parsed.data.start_reminder_enabled ?? false,
      start_reminder_minutes: parsed.data.start_reminder_minutes ?? 0,
      end_reminder_enabled: parsed.data.end_reminder_enabled ?? false,
      end_reminder_minutes: parsed.data.end_reminder_minutes ?? 0,
      due_bucket: parsed.data.due_bucket ?? null,
      due_bucket_position: parsed.data.due_bucket_position ?? null,
      priority: parsed.data.priority ?? 'medium',
      checked: derivedChecked,
      assignee_id: parsed.data.assignee_id ?? null,
      assigned_to: parsed.data.assigned_to ?? null,
      user_id: parsed.data.user_id ?? user.id,
      short_id: shortId,
      id_short: idShort,
      slug: slug,
      created_at: parsed.data.created_at,
      updated_at: parsed.data.updated_at,
      duration: parsed.data.duration ?? 60,
    };

    Object.keys(payload).forEach((key) => {
      if (payload[key] === undefined) {
        delete payload[key];
      }
    });

    const performInsert = async (body: Record<string, unknown>) =>
      await supabase
        .from('cards')
        .insert(body)
        .select()
        .single();

    let payloadToSend = payload;
    let { data: createdCard, error } = await performInsert(payloadToSend);

    const missingDueBucketColumn =
      !!error &&
      (error.code === '42703' ||
        (typeof error.message === 'string' && error.message.includes('due_bucket_position')));

    const missingChecklistColumn =
      !!error &&
      (error.code === '42703' ||
        (typeof error.message === 'string' && error.message.includes('checklist')));
    const missingContentColumn =
      !!error &&
      (error.code === '42703' ||
        (typeof error.message === 'string' && error.message.includes('content')));

    if (missingDueBucketColumn && 'due_bucket_position' in payloadToSend) {
      const fallbackPayload = { ...payloadToSend };
      delete fallbackPayload.due_bucket_position;
      ({ data: createdCard, error } = await performInsert(fallbackPayload));
    }

    if (missingChecklistColumn && 'checklist' in payloadToSend) {
      console.error('[cards POST] checklist column missing. Please apply migration 20251129090000_add_checklist_to_cards.sql');
      return NextResponse.json(
        { error: { code: 'MISSING_CHECKLIST_COLUMN', message: 'Checklist column is missing. Apply migration 20251129090000_add_checklist_to_cards.sql' } },
        { status: 500 }
      );
    }
    if (missingContentColumn && 'content' in payloadToSend) {
      console.error('[cards POST] content column missing. Please apply migration 20251220090000_add_card_content.sql');
      return NextResponse.json(
        { error: { code: 'MISSING_CONTENT_COLUMN', message: 'Content column is missing. Apply migration 20251220090000_add_card_content.sql' } },
        { status: 500 }
      );
    }

    if (error) {
      console.error('Error creating card:', error);
      return NextResponse.json(
        { error: { code: 'DB_ERROR', message: error.message } },
        { status: 500 }
      );
    }

    // Log activity
    supabase.from('activity_logs').insert({
      board_id: boardId,
      user_id: user.id,
      action: 'created',
      entity_type: 'card',
      entity_id: createdCard.id,
      entity_title: createdCard.title,
    }).then(({ error: logError }) => {
      if (logError) console.error('Activity log failed:', logError);
    });

    return NextResponse.json({ card: createdCard }, { status: 201 });
  } catch (error) {
    console.error('Unexpected error in POST /api/boards/[boardId]/cards:', error);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    );
  }
}
