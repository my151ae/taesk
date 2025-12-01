import { useDroppable } from '@dnd-kit/core';
import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { TimelineBucketItem, timeLabel } from '@/app/(board)/_utils/timeline-helpers';
import { bucketKeyToDueBucket } from '@/lib/bucket-normalization';
import { DraggableCard } from './TimelineDraggableCard';
import { TimelineCard } from './TimelineCard';
import { ChecklistEditor, ChecklistSaveTrigger } from '@/app/(board)/_components/checklist/ChecklistEditor';
import { ChecklistPreview } from '@/app/(board)/_components/checklist/ChecklistPreview';
import { Checklist, normalizeChecklist, countNonEmptyLines, EMPTY_CHECKLIST } from '@/lib/checklist';

const DROP_ZONE_MARGIN_PX = 12;

type TimelineBucketCardProps = {
    item: TimelineBucketItem;
    bucketKey: string;
    openCardModal: (shortId: string | null) => void;
    onToggleCheck: (cardId: string, checked: boolean) => void;
    onChecklistCommit: (cardId: string, checklist: Checklist, trigger: ChecklistSaveTrigger) => void;
    onChecklistEditingChange: (cardId: string, isEditing: boolean) => void;
    editingCardId: string | null;
    showFallbackBottomLine?: boolean;
};

export const TimelineBucketCard = ({
    item,
    bucketKey,
    openCardModal,
    onToggleCheck,
    onChecklistCommit,
    onChecklistEditingChange,
    editingCardId,
    showFallbackBottomLine = false,
}: TimelineBucketCardProps) => {
    const { setNodeRef: setTopRef, isOver: isOverTop } = useDroppable({
        id: `bucket-item-top:${bucketKey}:${item.card_id}`,
        data: { type: 'bucket-item-top', bucketKey, cardId: item.card_id },
    });

    const { setNodeRef: setBottomRef, isOver: isOverBottom } = useDroppable({
        id: `bucket-item-bottom:${bucketKey}:${item.card_id}`,
        data: { type: 'bucket-item-bottom', bucketKey, cardId: item.card_id },
    });

    const [draftChecklist, setDraftChecklist] = useState<Checklist>(normalizeChecklist(item.checklist ?? EMPTY_CHECKLIST));

    useEffect(() => {
        setDraftChecklist(normalizeChecklist(item.checklist ?? EMPTY_CHECKLIST));
    }, [item.checklist]);

    const isEditing = editingCardId === item.card_id;
    const lineCount = countNonEmptyLines(draftChecklist);

    return (
        <DraggableCard
            id={`bucket:${item.card_id}`}
            data={{ kind: 'bucket', cardId: item.card_id, bucketKey, item }}
            disabled={isEditing}
        >
            <div className="relative" data-testid={`ab-card-${item.card_id}`} data-bucket={bucketKey}>
                {/* Drop Zones */}
                <div
                    ref={setTopRef}
                    className="absolute left-0 right-0 z-20 pointer-events-none"
                    style={{ top: -DROP_ZONE_MARGIN_PX, height: `calc(50% + ${DROP_ZONE_MARGIN_PX}px)` }}
                />
                <div
                    ref={setBottomRef}
                    className="absolute left-0 right-0 z-20 pointer-events-none"
                    style={{ bottom: -DROP_ZONE_MARGIN_PX, height: `calc(50% + ${DROP_ZONE_MARGIN_PX}px)` }}
                />

                {/* Indicators */}
                {isOverTop && <div className="absolute left-0 right-0 top-0 h-0.5 bg-sky-500 z-30" />}
                {(isOverBottom || showFallbackBottomLine) && (
                    <div className="absolute left-0 right-0 bottom-0 h-0.5 bg-sky-500 z-30" />
                )}

                <TimelineCard
                    title={item.title || 'Untitled card'}
                    checked={item.checked}
                    onToggleCheck={(next) => onToggleCheck(item.card_id, next)}
                    badgeLabel={bucketKeyToDueBucket(bucketKey).toUpperCase()}
                    timeText={
                        <span className="flex items-center gap-1">
                            {item.due_start ? timeLabel(item.due_start, item.due_end) : null}
                            {lineCount > 0 && (
                                <span className="text-[9px] text-slate-400 font-normal">
                                    ☑︎ {lineCount}
                                </span>
                            )}
                        </span>
                    }
                    timePlacement="top"
                    onOpen={() => openCardModal(item.short_id)}
                    openButtonTestId={`cardOpenButton-${item.card_id}`}
                    className={clsx(isEditing ? 'min-h-[120px]' : 'min-h-[72px]', 'pt-4')}
                    childrenPosition="top"
                >
                    <div className="space-y-1">
                        {isEditing ? (
                            <ChecklistEditor
                                value={draftChecklist}
                                onChange={(next) => setDraftChecklist(next)}
                                onCommit={async (next, trigger) => {
                                    const normalized = normalizeChecklist(next);
                                    await onChecklistCommit(item.card_id, normalized, trigger);
                                }}
                                onEditingChange={(editing) => onChecklistEditingChange(item.card_id, editing)}
                                autoSaveDelayMs={1500}
                                placeholder="- [ ] タスクを書く"
                            />
                        ) : (
                            <ChecklistPreview
                                checklist={draftChecklist}
                                maxLines={3}
                                className="mt-0.5"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onChecklistEditingChange(item.card_id, true);
                                }}
                                onLineFocusRequest={(lineId, caretPos) => {
                                    onChecklistEditingChange(item.card_id, true);
                                    setTimeout(() => {
                                        const input = document.querySelector<HTMLInputElement>(`[data-checklist-line=\"${lineId}\"]`);
                                        if (input) {
                                            input.focus();
                                            if (typeof caretPos === 'number') {
                                                const pos = Math.min(Math.max(caretPos, 0), input.value.length);
                                                input.selectionStart = input.selectionEnd = pos;
                                            }
                                        }
                                    }, 0);
                                }}
                            />
                        )}
                    </div>
                </TimelineCard>
            </div>
        </DraggableCard>
    );
};
