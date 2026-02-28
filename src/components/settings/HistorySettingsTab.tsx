import { useHistoryStore } from '../../store/useHistoryStore';
import { Button } from '../ui/Button';
import { ScrollArea } from '../ui/ScrollArea';

export const HistorySettingsTab = () => {
    const { history, future, undo, redo, undoTo } = useHistoryStore();

    const formatDate = (ts: number) => {
        return new Date(ts).toLocaleTimeString();
    };

    return (
        <div className="space-y-4 h-full flex flex-col">
            <div>
                <h3 className="text-lg font-medium">Edit History</h3>
                <p className="text-sm text-muted-foreground">
                    View and reverse recent edits. "Undo to here" reverses all edits up to that point.
                </p>
            </div>

            <ScrollArea className="flex-1 border rounded-md p-4 bg-card">
                <div className="space-y-6">
                    {future.length > 0 && (
                        <div className="space-y-2 pb-4 border-b">
                            <div className="flex items-center justify-between">
                                <h4 className="text-sm font-semibold text-muted-foreground">Undone Actions (Redo Available)</h4>
                                <Button size="sm" variant="outline" onClick={redo}>
                                    Redo Latest
                                </Button>
                            </div>
                            {future.map((item, index) => (
                                <div key={`future-${index}`} className="flex items-center justify-between p-2 bg-muted/20 rounded opacity-60">
                                    <div>
                                        <div className="text-xs text-muted-foreground">{formatDate(item.timestamp)}</div>
                                        <div className="text-sm">{item.description}</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    <div className="space-y-2">
                        <h4 className="text-sm font-semibold text-muted-foreground">History</h4>
                        {history.length === 0 ? (
                            <p className="text-sm text-muted-foreground italic">No recent edits recorded.</p>
                        ) : (
                            history.map((item, index) => (
                                <div key={`history-${index}`} className="flex items-center justify-between p-3 hover:bg-muted/50 rounded transition-colors border bg-background">
                                    <div>
                                        <div className="text-xs text-muted-foreground">{formatDate(item.timestamp)}</div>
                                        <div className="text-sm font-medium">{item.description}</div>
                                    </div>
                                    <div className="flex gap-2">
                                        {index === 0 ? (
                                            <Button size="sm" variant="secondary" onClick={undo}>
                                                Undo
                                            </Button>
                                        ) : (
                                            <Button size="sm" variant="ghost" onClick={() => undoTo(index)}>
                                                Undo to here
                                            </Button>
                                        )}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </ScrollArea>
        </div>
    );
};
