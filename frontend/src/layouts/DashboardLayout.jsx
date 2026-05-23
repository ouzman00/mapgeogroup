import Navbar from "../components/ui/Navbar";
import Sidebar from "../components/ui/Sidebar";

const MAIN_BASE_CLASS = "min-h-0 flex-1";
const MAIN_CLASS_BY_MODE = {
  fullHeight: `${MAIN_BASE_CLASS} overflow-hidden p-3 sm:p-4 lg:p-5 xl:p-6`,
  default: `${MAIN_BASE_CLASS} overflow-visible px-4 py-5 sm:px-6 sm:py-6 md:overflow-y-auto lg:px-8 xl:px-10 xl:py-8`,
};

export default function DashboardLayout({
  title = "",
  subtitle = "",
  children,
  immersive = false,
  fullHeight = false,
  mainClassName = "",
}) {
  if (immersive) {
    return (
      <div className="flex min-h-dvh flex-col overflow-visible bg-[#08131d] text-mapgeo-primary md:h-dvh md:overflow-hidden">
        <main className="min-h-0 flex-1 overflow-visible md:overflow-hidden">{children}</main>
      </div>
    );
  }

  const resolvedMainClass = fullHeight
    ? MAIN_CLASS_BY_MODE.fullHeight
    : MAIN_CLASS_BY_MODE.default;

  return (
    <div className="min-h-dvh bg-mapgeo-ivory text-mapgeo-primary md:h-dvh md:overflow-hidden">
      <div className="flex min-h-dvh md:h-full md:min-h-0">
        <Sidebar />

        <div className="flex min-w-0 flex-1 flex-col overflow-visible md:overflow-hidden">
          <Navbar title={title} subtitle={subtitle} />

          <main className={`mapgeo-dashboard-main ${resolvedMainClass} ${mainClassName}`.trim()}>
            <div className={fullHeight ? "h-full min-h-0" : "mx-auto w-full max-w-[1600px]"}>
              {children}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
