import { KeyboardEvent, PointerEvent, memo, useEffect, useState } from 'react';
import { DraggableCard } from './TimelineDraggableCard';
import { TimelineCard } from './TimelineCard';
import {
    TimelineEvent,
    minuteToPixels,
    getMinutesFromTime,
    timeLabel,
    minutesToTime,
    EventLayout
} from '@/app/(board)/_utils/timeline-helpers';
import { ActiveResizeState } from '@/app/(board)/_hooks/useTimelineDragAndDrop';
import { ChecklistEditor, ChecklistSaveTrigger } from '@/app/(board)/_components/checklist/ChecklistEditor';
import { ChecklistPreview } from '@/app/(board)/_components/checklist/ChecklistPreview';
import { Checklist, normalizeChecklist, EMPTY_CHECKLIST, countNonEmptyLines } from '@/lib/checklist';

type TimelineEventItemProps = {
    event: TimelineEvent;
    layout?: EventLayout;
    activeResize: ActiveResizeState | null;
    openCardModal: (shortId: string | null, source: string) => void;
    handleEventKeyDown: (event: TimelineEvent, native: KeyboardEvent<HTMLElement>) => void;
    handleResizeStart: (e: PointerEvent, cardId: string, startMinutes: number, duration: number, edge: 'top' | 'bottom') => void;
    handleResizeMove: (e: PointerEvent) => void;
    handleResizeEnd: (e: PointerEvent) => void;
    onToggleCheck: (cardId: string, checked: boolean) => void;
    onClearGhost: () => void;
    onChecklistCommit: (cardId: string, checklist: Checklist, trigger: ChecklistSaveTrigger) => void;
    onChecklistEditingChange: (cardId: string, editing: boolean) => void;
    editingCardId: string | null;
};

export const TimelineEventItem = memo(function TimelineEventItem({
    event,
    layout,
    activeResize,
    openCardModal,
    handleEventKeyDown,
    handleResizeStart,
    handleResizeMove,
    handleResizeEnd,
    onToggleCheck,
    onClearGhost,
    onChecklistCommit,
    onChecklistEditingChange,
    editingCardId,
}: TimelineEventItemProps) {
    let start = getMinutesFromTime(event.due_start ?? null) ?? 0;
    let duration = Math.max(event.durationMinutes ?? 60, 30);

    if (activeResize && activeResize.cardId === event.card_id) {
        start = activeResize.startMinutes;
        duration = activeResize.duration;
    }

    const top = minuteToPixels(start);
    const height = Math.max(minuteToPixels(duration), 32);
    const [draftChecklist, setDraftChecklist] = useState<Checklist>(normalizeChecklist(event.checklist ?? EMPTY_CHECKLIST));

    useEffect(() => {
        setDraftChecklist(normalizeChecklist(event.checklist ?? EMPTY_CHECKLIST));
    }, [event.checklist]);

    const isEditing = editingCardId === event.card_id;

    return (
        <DraggableCard
            key={event.card_id}
            id={`event:${event.card_id}`}
            data={{ kind: 'event', event, cardId: event.card_id }}
            attachListenersToChild
            disabled={isEditing}
        >
            <div
                className="absolute transition hover:border-sky-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
                style={{
                    top,
                    height,
                    left: layout?.left ?? '0%',
                    width: layout?.width ?? '100%',
                }}
                onClick={(e) => {
                    e.stopPropagation();
                    onClearGhost();
                }}
            >
                <TimelineCard
                    title={event.title || 'Untitled card'}
                    checked={event.checked}
                    onToggleCheck={(next) => onToggleCheck(event.card_id, next)}
                    badgeLabel={(event.due_bucket ?? 'a').toUpperCase()}
                    timeText={
                        <span className="flex items-center gap-1">
                            {timeLabel(event.due_start, event.due_end)}
                            {countNonEmptyLines(draftChecklist) > 0 && (
                                <span className="text-[9px] text-slate-400 font-normal">
                                    ☑︎ {countNonEmptyLines(draftChecklist)}
                                </span>
                            )}
                        </span>
                    }
                    onOpen={() => openCardModal(event.short_id, 'event-button')}
                    openButtonTestId={`cardOpenButton-${event.card_id}`}
                    dataTestId="timeline-event"
                    tabIndex={0}
                    role="group"
                    onKeyDown={(native) => handleEventKeyDown(event, native)}
                    className="w-full h-full pt-4"
                    childrenPosition="top"
                >
                    <div className="">
                        {isEditing ? (
                            <ChecklistEditor
                                value={draftChecklist}
                                onChange={(next) => setDraftChecklist(next)}
                                onCommit={async (next, trigger) => {
                                    const normalized = normalizeChecklist(next);
                                    await onChecklistCommit(event.card_id, normalized, trigger);
                                }}
                                onEditingChange={(editing) => onChecklistEditingChange(event.card_id, editing)}
                                autoSaveDelayMs={1500}
                                placeholder="- [ ] タスクを書く"
                            />
                        ) : (
                            <ChecklistPreview
                                checklist={draftChecklist}
                                maxLines={3}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onChecklistEditingChange(event.card_id, true);
                                }}
                                onLineFocusRequest={(lineId, caretPos) => {
                                    onChecklistEditingChange(event.card_id, true);
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
                    <div
                        className="absolute top-0 left-0 right-0 h-3 cursor-ns-resize opacity-0 hover:opacity-100 z-10"
                        onPointerDown={(e) => handleResizeStart(e, event.card_id, start, duration, 'top')}
                        onPointerMove={handleResizeMove}
                        onPointerUp={handleResizeEnd}
                    />
                    <div
                        className="absolute bottom-0 left-0 right-0 h-3 cursor-ns-resize opacity-0 hover:opacity-100 z-10"
                        onPointerDown={(e) => handleResizeStart(e, event.card_id, start, duration, 'bottom')}
                        onPointerMove={handleResizeMove}
                        onPointerUp={handleResizeEnd}
                    />
                </TimelineCard>
            </div>
        </DraggableCard >
    );
});
