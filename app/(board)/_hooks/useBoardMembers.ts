import { useState, useEffect } from 'react';
import { useBoardMembersStore, type BoardMember } from '@/app/(board)/_stores/board-members-store';
import { type ProfileSummary } from '@/lib/supabase';
import { useAuth } from '@/app/contexts/AuthContext';

export function useBoardMembers(currentBoardId: string | null) {
    const { user } = useAuth();
    const [boardMembers, setBoardMembers] = useState<ProfileSummary[]>([]);
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
                    setBoardMembers(cached.map(m => m.profile));
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

                const { members } = await response.json();
                const boardMembers: BoardMember[] = members.map((m: any) => ({
                    profile: m.profile,
                    role: m.role
                }));
                const profiles: ProfileSummary[] = boardMembers.map(m => m.profile);

                if (!isDisposed) {
                    setBoardMembers(profiles);
                    setStoredMembers(currentBoardId, boardMembers); // Save to store
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
