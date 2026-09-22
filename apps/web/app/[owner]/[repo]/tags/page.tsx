import RefsPage from "../refs";

export default function Page({ params }: { params: Promise<{ owner: string; repo: string }> }) {
  return <RefsPage params={params} kind="tags" />;
}
