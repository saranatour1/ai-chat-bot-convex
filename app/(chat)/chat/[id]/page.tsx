'use client'
import { cookies } from 'next/headers';

import { Chat } from '@/components/chat';
import { DataStreamHandler } from '@/components/data-stream-handler';
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
