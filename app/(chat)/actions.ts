'use server';
import type { VisibilityType } from '@/components/visibility-selector';

export async function updateChatVisibility({
  chatId,
  visibility,
}: {
  chatId: string;
  visibility: VisibilityType;
}) {
  // await updateChatVisiblityById({ chatId, visibility });
}
