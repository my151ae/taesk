import {
    ReactNode,
    ReactElement,
    isValidElement,
    cloneElement,
    useCallback,
    type HTMLAttributes,
    type RefCallback,
} from 'react';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';

export type TimelineDragHandleProps = {
    ref: RefCallback<HTMLElement>;
    style: { touchAction: 'none' };
} & HTMLAttributes<HTMLElement>;

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
    children: ReactNode | ((dragHandleProps: TimelineDragHandleProps) => ReactNode);
    extraNodeRef?: (node: HTMLElement | null) => void;
    attachListenersToChild?: boolean;
    disabled?: boolean;
}) => {
    const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, isDragging } = useDraggable({
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

    const draggableAttributes = disabled ? {} : { ...attributes, tabIndex: -1 };

    const draggingClass = !disabled && isDragging ? 'pointer-events-none opacity-0' : '';

    const dragHandleProps: TimelineDragHandleProps = {
        ref: setActivatorNodeRef,
        style: { touchAction: 'none' },
        ...(disabled ? {} : listeners),
        ...draggableAttributes,
    };

    const hasDedicatedHandle = typeof children === 'function';
    const resolvedChildren = hasDedicatedHandle ? children(dragHandleProps) : children;

    if (attachListenersToChild && isValidElement(resolvedChildren)) {
        const child = resolvedChildren as ReactElement;
        const mergedRef = (node: HTMLElement | null) => {
            combinedRef(node);
        };
        const childListeners = hasDedicatedHandle || disabled ? {} : listeners;
        const childAttributes = hasDedicatedHandle || disabled ? {} : draggableAttributes;
        return cloneElement(child, {
            ref: mergedRef,
            style: {
                ...(child.props.style ?? {}),
                transform: CSS.Translate.toString(transform),
                touchAction: 'manipulation',
            },
            className: [child.props.className, draggingClass].filter(Boolean).join(' '),
            ...childListeners,
            ...childAttributes,
        });
    }

    return (
        <div
            ref={combinedRef}
            style={{ transform: CSS.Translate.toString(transform), touchAction: 'manipulation' }}
            className={draggingClass || undefined}
            {...(disabled ? {} : listeners)}
            {...draggableAttributes}
        >
            {resolvedChildren}
        </div>
    );
};
