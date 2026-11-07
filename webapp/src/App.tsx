import { useCallback, useEffect, useState } from 'react';
import { ApiError, Card, Limits, User, api, isInsideTelegram } from './api';
import { AlertIcon, CardIcon, DoneAllIcon, InboxIcon, ReceiptIcon, SendIcon, UserIcon, UsersIcon } from './components/icons';
import { IconType, Loading, Tabs } from './components/ui';
import { CardTab, DriversTab, OperatorsTab, ReportTab } from './screens/Admin';
import { DriverApp } from './screens/Driver';
import { HandledTab, QueueTab } from './screens/Staff';

type StaffTab = 'queue' | 'handled' | 'report' | 'drivers' | 'operators' | 'card';

function StaffApp({ user }: { user: User }) {
  const [tab, setTab] = useState<StaffTab>('queue');
  const [newCount, setNewCount] = useState(0);
  const [reportOperator, setReportOperator] = useState<string | undefined>();
  const [reportQuery, setReportQuery] = useState<string | undefined>();
  const isAdmin = user.role === 'superadmin';

  const onCount = useCallback((count: number) => setNewCount(count), []);

  return (
    <>
      <main className="screen" key={tab}>
        {tab === 'queue' && <QueueTab me={user} onCount={onCount} />}
        {tab === 'handled' && <HandledTab />}
        {tab === 'report' && (
          <ReportTab
            key={`${reportOperator ?? ''}|${reportQuery ?? ''}`}
            initialOperatorId={reportOperator}
            initialQuery={reportQuery}
          />
        )}
        {tab === 'drivers' && (
          <DriversTab
            onOpenPayments={(query) => {
              setReportOperator(undefined);
              setReportQuery(query);
              setTab('report');
            }}
          />
        )}
        {tab === 'operators' && (
          <OperatorsTab
            onOpenPayments={(id) => {
              setReportQuery(undefined);
              setReportOperator(id);
              setTab('report');
            }}
          />
        )}
        {tab === 'card' && <CardTab />}
      </main>
      <Tabs
        active={tab}
        onChange={(next) => {
          if (next === 'report') {
            setReportOperator(undefined);
            setReportQuery(undefined);
          }
          setTab(next);
        }}
        tabs={
          isAdmin
            ? [
                { id: 'queue', label: 'Navbat', icon: InboxIcon, badge: newCount },
                { id: 'report', label: "To'lovlar", icon: ReceiptIcon },
                { id: 'drivers', label: 'Haydovchilar', icon: UserIcon },
                { id: 'operators', label: 'Operatorlar', icon: UsersIcon },
                { id: 'card', label: 'Karta', icon: CardIcon },
              ]
            : [
                { id: 'queue', label: 'Navbat', icon: InboxIcon, badge: newCount },
                { id: 'handled', label: 'Amallarim', icon: DoneAllIcon },
              ]
        }
      />
    </>
  );
}

function Blocked({ icon: Icon, title, text, retry }: { icon: IconType; title: string; text: string; retry?: () => void }) {
  return (
    <main className="screen screen-center">
      <span className="empty-icon"><Icon size={28} /></span>
      <h1>{title}</h1>
      <p className="muted">{text}</p>
      {retry && <button className="btn" onClick={retry}>Qayta urinish</button>}
    </main>
  );
}

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [limits, setLimits] = useState<Limits | null>(null);
  const [card, setCard] = useState<Card | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(() => {
    setError(null);
    api
      .me()
      .then((res) => {
        setUser(res.user);
        setLimits(res.limits);
        setCard(res.card);
      })
      .catch((err) => setError(err instanceof ApiError ? err : new ApiError(0, 'ERROR', 'Xatolik yuz berdi')));
  }, []);

  useEffect(() => {
    if (isInsideTelegram()) load();
  }, [load]);

  if (!isInsideTelegram()) {
    return <Blocked icon={SendIcon} title="Ilovani Telegram'da oching" text="Bu sahifa faqat bot ichida ishlaydi." />;
  }
  if (error) {
    return <Blocked icon={AlertIcon} title="Ilova ochilmadi" text={error.message} retry={error.status === 401 ? undefined : load} />;
  }
  if (!user || !limits) {
    return (
      <main className="screen screen-plain">
        <Loading rows={2} />
      </main>
    );
  }
  return user.role === 'driver' ? (
    <DriverApp user={user} limits={limits} card={card} onUserChange={setUser} />
  ) : (
    <StaffApp user={user} />
  );
}
