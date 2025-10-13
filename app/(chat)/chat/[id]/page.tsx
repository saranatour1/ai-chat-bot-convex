import { ChatLayout } from "@/components/chat-layout";

interface PageProps{
  params:Promise<{id:string}>
}

export default async function Page({params}:PageProps) {
  const { id } = (await params)
  return (
    <>
      <ChatLayout threadId={id}/>  
    </>
  );
}
