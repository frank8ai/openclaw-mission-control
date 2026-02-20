export default function MoneyPage() {
  const tasks = [
    { id: 1, title: 'Finalize Web3 security service offer', status: 'pending', priority: 'high' },
    { id: 2, title: 'Post 3X content about honeypot detection', status: 'pending', priority: 'high' },
    { id: 3, title: 'Reach out to 5 potential clients', status: 'pending', priority: 'medium' },
    { id: 4, title: 'Create 1-page sales page', status: 'done', priority: 'high' },
    { id: 5, title: 'Write outreach DM templates', status: 'done', priority: 'high' },
  ];

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-6">💰 Money Tasks - $1M Goal</h1>
      
      <div className="space-y-4">
        {tasks.map(task => (
          <div 
            key={task.id}
            className={`p-4 bg-zinc-900 rounded-lg border ${
              task.status === 'done' ? 'border-green-900' : 'border-zinc-800'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className={task.status === 'done' ? 'text-green-500' : 'text-zinc-500'}>
                  {task.status === 'done' ? '✓' : '○'}
                </span>
                <span className={task.status === 'done' ? 'text-zinc-500 line-through' : ''}>
                  {task.title}
                </span>
              </div>
              <span className={`text-xs px-2 py-1 rounded ${
                task.priority === 'high' ? 'bg-red-900 text-red-200' : 'bg-zinc-800 text-zinc-400'
              }`}>
                {task.priority}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-8 p-6 bg-zinc-900 rounded-lg border border-zinc-800">
        <h3 className="text-lg font-semibold mb-4">📊 Progress</h3>
        <div className="w-full bg-zinc-800 rounded-full h-4">
          <div className="bg-green-600 h-4 rounded-full" style={{ width: '40%' }}></div>
        </div>
        <p className="text-sm text-zinc-400 mt-2">2/5 tasks completed</p>
      </div>
    </div>
  );
}
