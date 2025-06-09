import { Chat } from '@/components/chat';
import { DataStreamHandler } from '@/components/data-stream-handler';

interface PageProps{
  params:Promise<{id:string}>
}

export default async function Page({params}:PageProps) {
  const { id } = (await params)
  return (
    <>
      <Chat
        chatId={id}
      />
      {/* <DataStreamHandler id={id} /> */}
    </>
  );
}
