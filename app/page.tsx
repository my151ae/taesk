"use client";

import { useState, useEffect } from "react";
import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  closestCorners,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  verticalListSortingStrategy,
  horizontalListSortingStrategy,
} from "@dnd-kit/sortable";
import { v4 as uuidv4 } from "uuid";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

// Types - Supabaseのテーブル構造を想定
interface Card {
  id: string;
  title: string;
  description: string;
  list_id: string;
  position: number;
  created_at: string;
  updated_at: string;
}

interface List {
  id: string;
  title: string;
  position: number;
  created_at: string;
  updated_at: string;
}

interface BoardData {
  lists: List[];
  cards: Card[];
}

// LocalStorage helper - 後でSupabaseクライアントに置き換え可能
const STORAGE_KEY = "kanban_board_data";

const loadFromStorage = (): BoardData => {
  if (typeof window === "undefined") return { lists: [], cards: [] };
  const data = localStorage.getItem(STORAGE_KEY);
  if (!data) {
    // 初期データ
    return {
      lists: [
        {
          id: uuidv4(),
          title: "To Do",
          position: 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          id: uuidv4(),
          title: "In Progress",
          position: 1,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          id: uuidv4(),
          title: "Done",
          position: 2,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
      cards: [],
    };
  }
  return JSON.parse(data);
};

const saveToStorage = (data: BoardData) => {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
};

// Sortable Card Component
function SortableCard({
  card,
  onEdit,
  onDelete,
}: {
  card: Card;
  onEdit: (id: string, title: string, description: string) => void;
  onDelete: (id: string) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    data: {
      type: "card",
      card,
    },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const handleSave = () => {
    onEdit(card.id, title, description);
    setIsEditing(false);
  };

  const handleCancel = () => {
    setTitle(card.title);
    setDescription(card.description);
    setIsEditing(false);
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="bg-white dark:bg-gray-800 rounded-xl shadow-sm hover:shadow-md transition-shadow p-4 mb-3 cursor-grab active:cursor-grabbing border border-slate-200/60 dark:border-gray-700/50 touch-none"
    >
      {isEditing ? (
        <div className="space-y-3">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full px-3 py-2 border border-slate-200 rounded-lg dark:bg-gray-700 dark:border-gray-600 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300 focus:border-transparent"
            placeholder="Card title"
            autoFocus
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full px-3 py-2 border border-slate-200 rounded-lg dark:bg-gray-700 dark:border-gray-600 text-sm focus:outline-none focus:ring-2 focus:ring-sky-300 focus:border-transparent resize-none"
            placeholder="Description"
            rows={2}
          />
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              className="px-3 py-1.5 bg-sky-400 text-white rounded-lg text-sm hover:bg-sky-500 transition-colors font-medium"
            >
              Save
            </button>
            <button
              onClick={handleCancel}
              className="px-3 py-1.5 bg-slate-200 dark:bg-gray-600 text-slate-700 dark:text-gray-200 rounded-lg text-sm hover:bg-slate-300 dark:hover:bg-gray-500 transition-colors font-medium"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div>
          <h3 className="font-semibold mb-1.5 text-sm text-slate-700 dark:text-gray-100">{card.title}</h3>
          {card.description && (
            <p className="text-xs text-slate-500 dark:text-gray-400 mb-3 leading-relaxed">{card.description}</p>
          )}
          <div className="flex gap-3 mt-3 pt-2 border-t border-slate-100 dark:border-gray-700">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsEditing(true);
              }}
              className="text-xs text-sky-500 hover:text-sky-600 font-medium transition-colors"
            >
              Edit
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(card.id);
              }}
              className="text-xs text-rose-400 hover:text-rose-500 font-medium transition-colors"
            >
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Sortable List Component
function SortableList({
  list,
  cards,
  onAddCard,
  onEditCard,
  onDeleteCard,
  onEditList,
  onDeleteList,
}: {
  list: List;
  cards: Card[];
  onAddCard: (listId: string) => void;
  onEditCard: (id: string, title: string, description: string) => void;
  onDeleteCard: (id: string) => void;
  onEditList: (id: string, title: string) => void;
  onDeleteList: (id: string) => void;
}) {
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [title, setTitle] = useState(list.title);
  const [showMenu, setShowMenu] = useState(false);

  useEffect(() => {
    const handleClickOutside = () => setShowMenu(false);
    if (showMenu) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [showMenu]);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: list.id,
    data: {
      type: "list",
      list,
    },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const handleSaveTitle = () => {
    onEditList(list.id, title);
    setIsEditingTitle(false);
  };

  const sortedCards = [...cards].sort((a, b) => a.position - b.position);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="bg-white/70 dark:bg-gray-800/60 backdrop-blur-sm rounded-2xl p-4 w-80 flex-shrink-0 touch-none border border-slate-200/50 dark:border-gray-700/50 shadow-md self-start"
      data-type="list"
    >
      <div {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing mb-4">
        {isEditingTitle ? (
          <div className="flex gap-2">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={handleSaveTitle}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSaveTitle();
                if (e.key === "Escape") {
                  setTitle(list.title);
                  setIsEditingTitle(false);
                }
              }}
              className="flex-1 px-3 py-2 border border-slate-200 rounded-lg dark:bg-gray-700 dark:border-gray-600 font-semibold focus:outline-none focus:ring-2 focus:ring-sky-300 focus:border-transparent"
              autoFocus
            />
          </div>
        ) : (
          <div className="flex justify-between items-center">
            <h2 className="font-bold text-lg text-slate-700 dark:text-gray-100">
              {list.title}
            </h2>
            <div className="relative">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowMenu(!showMenu);
                }}
                className="text-slate-400 hover:text-slate-600 text-xl font-bold transition-colors w-6 h-6 flex items-center justify-center rounded hover:bg-slate-100"
              >
                ⋯
              </button>
              {showMenu && (
                <div className="absolute right-0 mt-2 w-40 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-slate-200 dark:border-gray-700 py-1 z-10">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowMenu(false);
                      setIsEditingTitle(true);
                    }}
                    className="w-full text-left px-4 py-2 text-sm text-slate-700 dark:text-gray-200 hover:bg-slate-100 dark:hover:bg-gray-700"
                  >
                    Rename
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowMenu(false);
                      if (confirm(`Delete list "${list.title}"?`)) {
                        onDeleteList(list.id);
                      }
                    }}
                    className="w-full text-left px-4 py-2 text-sm text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20"
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="mb-4 px-1">
        <SortableContext items={sortedCards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          {sortedCards.map((card) => (
            <SortableCard
              key={card.id}
              card={card}
              onEdit={onEditCard}
              onDelete={onDeleteCard}
            />
          ))}
        </SortableContext>
      </div>

      <button
        onClick={() => onAddCard(list.id)}
        className="w-full py-2.5 bg-sky-400 text-white rounded-lg hover:bg-sky-500 text-sm font-medium transition-colors shadow-sm hover:shadow-md"
      >
        + Add Card
      </button>
    </div>
  );
}

// Main Kanban Board Component
export default function KanbanBoard() {
  const [boardData, setBoardData] = useState<BoardData>({ lists: [], cards: [] });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
    setBoardData(loadFromStorage());
  }, []);

  // モバイル対応のセンサー設定
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // 8px移動後にドラッグ開始（誤操作防止）
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 200, // 200ms長押しでドラッグ開始（スクロールと区別）
        tolerance: 8,
      },
    })
  );

  const updateData = (newData: BoardData) => {
    setBoardData(newData);
    saveToStorage(newData);
  };

  const handleAddList = () => {
    const newList: List = {
      id: uuidv4(),
      title: "New List",
      position: boardData.lists.length,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    updateData({ ...boardData, lists: [...boardData.lists, newList] });
  };

  const handleAddCard = (listId: string) => {
    const newCard: Card = {
      id: uuidv4(),
      title: "New Card",
      description: "",
      list_id: listId,
      position: boardData.cards.filter((c) => c.list_id === listId).length,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    updateData({ ...boardData, cards: [...boardData.cards, newCard] });
  };

  const handleEditCard = (id: string, title: string, description: string) => {
    const updatedCards = boardData.cards.map((card) =>
      card.id === id ? { ...card, title, description, updated_at: new Date().toISOString() } : card
    );
    updateData({ ...boardData, cards: updatedCards });
  };

  const handleDeleteCard = (id: string) => {
    const updatedCards = boardData.cards.filter((card) => card.id !== id);
    updateData({ ...boardData, cards: updatedCards });
  };

  const handleEditList = (id: string, title: string) => {
    const updatedLists = boardData.lists.map((list) =>
      list.id === id ? { ...list, title, updated_at: new Date().toISOString() } : list
    );
    updateData({ ...boardData, lists: updatedLists });
  };

  const handleDeleteList = (id: string) => {
    const updatedLists = boardData.lists.filter((list) => list.id !== id);
    const updatedCards = boardData.cards.filter((card) => card.list_id !== id);
    updateData({ lists: updatedLists, cards: updatedCards });
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) return;

    const activeData = active.data.current;
    const overData = over.data.current;

    // カードをリスト間で移動
    if (activeData?.type === "card") {
      const activeCard = activeData.card as Card;

      // カードの上にドロップした場合
      if (overData?.type === "card") {
        const overCard = overData.card as Card;
        if (activeCard.list_id !== overCard.list_id) {
          const updatedCards = boardData.cards.map((card) => {
            if (card.id === activeCard.id) {
              return { ...card, list_id: overCard.list_id, updated_at: new Date().toISOString() };
            }
            return card;
          });
          setBoardData({ ...boardData, cards: updatedCards });
        }
      }
      // リストの上に直接ドロップした場合
      else if (overData?.type === "list") {
        const overList = overData.list as List;
        if (activeCard.list_id !== overList.id) {
          const updatedCards = boardData.cards.map((card) => {
            if (card.id === activeCard.id) {
              return { ...card, list_id: overList.id, updated_at: new Date().toISOString() };
            }
            return card;
          });
          setBoardData({ ...boardData, cards: updatedCards });
        }
      }
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);

    if (!over) return;

    const activeData = active.data.current;
    const overData = over.data.current;

    // リストの並び替え
    if (activeData?.type === "list" && overData?.type === "list") {
      const oldIndex = boardData.lists.findIndex((list) => list.id === active.id);
      const newIndex = boardData.lists.findIndex((list) => list.id === over.id);

      if (oldIndex !== newIndex) {
        const newLists = arrayMove(boardData.lists, oldIndex, newIndex).map((list, index) => ({
          ...list,
          position: index,
          updated_at: new Date().toISOString(),
        }));
        updateData({ ...boardData, lists: newLists });
      }
      return;
    }

    // カードの並び替え
    if (activeData?.type === "card" && overData?.type === "card") {
      const activeCard = activeData.card as Card;
      const overCard = overData.card as Card;

      const listCards = boardData.cards.filter((c) => c.list_id === overCard.list_id);
      const oldIndex = listCards.findIndex((c) => c.id === active.id);
      const newIndex = listCards.findIndex((c) => c.id === over.id);

      if (oldIndex !== newIndex) {
        const newListCards = arrayMove(listCards, oldIndex, newIndex).map((card, index) => ({
          ...card,
          position: index,
          list_id: overCard.list_id,
          updated_at: new Date().toISOString(),
        }));

        const otherCards = boardData.cards.filter((c) => c.list_id !== overCard.list_id);
        updateData({ ...boardData, cards: [...otherCards, ...newListCards] });
      }
    }
  };

  const sortedLists = [...boardData.lists].sort((a, b) => a.position - b.position);

  if (!isClient) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-white via-slate-50/30 to-blue-50/50 p-8">
      <div className="max-w-full">
        <h1 className="text-4xl font-bold mb-8 text-slate-700 tracking-tight">Taesk Board</h1>

        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          <div className="flex gap-4 overflow-x-auto pb-4">
            <SortableContext items={sortedLists.map((l) => l.id)} strategy={horizontalListSortingStrategy}>
              {sortedLists.map((list) => (
                <SortableList
                  key={list.id}
                  list={list}
                  cards={boardData.cards.filter((card) => card.list_id === list.id)}
                  onAddCard={handleAddCard}
                  onEditCard={handleEditCard}
                  onDeleteCard={handleDeleteCard}
                  onEditList={handleEditList}
                  onDeleteList={handleDeleteList}
                />
              ))}
            </SortableContext>

            <button
              onClick={handleAddList}
              className="bg-white/40 dark:bg-gray-800/40 backdrop-blur-sm rounded-2xl p-6 w-80 flex-shrink-0 h-fit hover:bg-white/60 dark:hover:bg-gray-800/60 border-2 border-dashed border-slate-300/60 dark:border-gray-600/50 transition-all hover:border-sky-300 dark:hover:border-sky-400 shadow-sm"
            >
              <span className="text-slate-600 dark:text-gray-400 font-medium">+ Add List</span>
            </button>
          </div>

          <DragOverlay>
            {activeId ? (
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl p-4 opacity-95 rotate-2 cursor-grabbing border border-sky-300 scale-105">
                <span className="text-sm text-slate-600 dark:text-gray-300 font-medium">Dragging...</span>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>
    </div>
  );
}
