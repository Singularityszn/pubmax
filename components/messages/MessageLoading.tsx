import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import SampleSkeleton from "@/components/ui/sample-skeleton";

export function InboxLoading() {
  return <>
    <p className="conversationPreview">With you in a sec.</p>
    <SampleSkeleton label="Loading conversations">
      <ul className="conversationList">
        {[0, 1, 2].map(row => <li key={row} className="conversationItem">
          <div className="conversationLink">
            <span className="messageAvatar" style={{ width: 56, height: 56 }} data-sample-block="" />
            <div className="conversationBody">
              <div className="conversationHandle">Conversation</div>
              <div className="conversationPreview">The latest message in your conversation.</div>
            </div>
          </div>
        </li>)}
      </ul>
    </SampleSkeleton>
  </>;
}

export function ThreadLoading() {
  return <>
    <p className="conversationPreview">With you in a sec.</p>
    <SampleSkeleton label="Loading messages">
      <ul className="threadMessages">
        {[0, 1, 2].map(row => <li key={row} className={`messageRow${row === 1 ? " messageRowMine" : ""}`}>
          <div className="messageLine"><div className="messageBubble">A message in this conversation.</div></div>
        </li>)}
      </ul>
    </SampleSkeleton>
  </>;
}

export function ThreadLoadingShell() {
  return <div className="messageThread">
    <div className="threadHeader">
      <Link data-pressable href="/messages" className="threadBackLink" aria-label="Back to inbox">
        <ChevronLeft size={24} aria-hidden="true" />
      </Link>
      <SampleSkeleton label="Loading conversation" className="threadWith">
        <span className="messageAvatar" style={{ width: 36, height: 36 }} data-sample-block="" />
        <span className="threadWithHandle">Conversation</span>
      </SampleSkeleton>
    </div>
    <ThreadLoading />
  </div>;
}
