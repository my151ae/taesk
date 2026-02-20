import { useState, useEffect } from 'react';
import { useBoardMembersStore, type BoardMember } from '@/app/(board)/_stores/board-members-store';
import { useAuth } from '@/app/contexts/AuthContext';

export function useBoardMembers(currentBoardId: string | null) {
    const { user } = useAuth();
    const [boardMembers, setBoardMembers] = useState<BoardMember[]>([]);
    const { setMembers: setStoredMembers, getMembers: getStoredMembers, shouldRefetch } = useBoardMembersStore();

    useEffect(() => {
        let isDisposed = false;

        const loadBoardMembers = async () => {
            if (!user || !currentBoardId) {
                if (!isDisposed) {
                    setBoardMembers([]);
                }
                return;
            }

            // Check cache first
            const cached = getStoredMembers(currentBoardId);
            if (cached && !shouldRefetch(currentBoardId)) {
                if (!isDisposed) {
                    setBoardMembers(cached);
                }
                return;
            }

            try {
                const response = await fetch(`/api/boards/${currentBoardId}/members`);

                if (!response.ok) {
                    console.warn('Error loading board members:', response.statusText);
                    if (!isDisposed) {
                        setBoardMembers([]);
                    }
                    return;
                }

                const { members } = await response.json() as { members: Array<{ profile: BoardMember['profile']; role: BoardMember['role'] }> };
                const nextBoardMembers: BoardMember[] = members.map((m) => ({
                    profile: m.profile,
                    role: m.role
                }));

                if (!isDisposed) {
                    setBoardMembers(nextBoardMembers);
                    setStoredMembers(currentBoardId, nextBoardMembers); // Save to store
                }
            } catch (error) {
                console.error('Unexpected error loading board members:', error);
                if (!isDisposed) {
                    setBoardMembers([]);
                }
            }
        };

        loadBoardMembers();

        return () => {
            isDisposed = true;
        };
    }, [user, currentBoardId, getStoredMembers, setStoredMembers, shouldRefetch]);

    return { boardMembers, setBoardMembers };
}
