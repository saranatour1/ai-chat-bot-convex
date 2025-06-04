"use client"
import { Chat } from '@/components/chat';
import { useParams } from 'next/navigation';

export default function Page() {
  const { id } = useParams<{id:string}>();
  return (
    <>
      <Chat
        chatId={id}
      />
      {/* <DataStreamHandler id={id} /> */}
    </>
  );
}
