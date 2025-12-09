import { KioskContainer } from "@/features/face-check/containers/kiosk-container";

export const metadata = {
  title: "Face Check-in Kiosk",
  description: "Full-screen face recognition kiosk for check-in",
};

export default function KioskPage() {
  return <KioskContainer />;
}

