import { ReactNode, ReactElement, isValidElement, cloneElement, useCallback } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';

export const DraggableCard = ({
    id,
    data,
    children,
    extraNodeRef,
    attachListenersToChild = false,
    disabled = false,
}: {
    id: string;
    data: Record<string, unknown>;
    children: ReactNode;
    extraNodeRef?: (node: HTMLElement | null) => void;
    attachListenersToChild?: boolean;
    disabled?: boolean;
}) => {
    const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
        id,
        data: { ...data, id },
        disabled,
    });
    const combinedRef = useCallback(
        (node: HTMLElement | null) => {
            setNodeRef(node);
            if (extraNodeRef) {
                extraNodeRef(node);
            }
        },
        [extraNodeRef, setNodeRef]
    );

    if (attachListenersToChild && isValidElement(children)) {
        const child = children as ReactElement;
        const mergedRef = (node: HTMLElement | null) => {
            combinedRef(node);
        };
        return cloneElement(child, {
            ref: mergedRef,
            style: {
                ...(child.props.style ?? {}),
                transform: CSS.Translate.toString(transform),
                touchAction: 'manipulation',
            },
            className: [child.props.className, !disabled && isDragging ? 'z-30 opacity-80' : undefined].filter(Boolean).join(' '),
            ...(disabled ? {} : listeners),
            ...(disabled ? {} : attributes),
        });
    }

    return (
        <div
            ref={combinedRef}
            style={{ transform: CSS.Translate.toString(transform), touchAction: 'manipulation' }}
            className={!disabled && isDragging ? 'z-30 opacity-80' : undefined}
            {...(disabled ? {} : listeners)}
            {...(disabled ? {} : attributes)}
        >
            {children}
        </div>
    );
};
