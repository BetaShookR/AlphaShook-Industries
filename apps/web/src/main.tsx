import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Link, Route, Routes } from "react-router";
import "./styles.css";
import { SessionProvider, useSession } from "./hooks";
import { Header } from "./components/ui";
import { CatalogPage, HomePage, ProductPage } from "./pages/store";
import { LibraryPage, WishlistPage } from "./pages/library";
import { AdminPage, DevDashboardPage, DevelopersPage, DevProductPage } from "./pages/developers";
import { BoardPage, ForumsPage, FriendsPage, ProfilePage, ThreadPage } from "./pages/community";
import { AccountPage, ForgotPasswordPage, LoginPage, RegisterPage, ResetPasswordPage, VerifyEmailPage } from "./pages/account";

function Footer() {
  const { identity } = useSession();
  return (
    <footer className="footer">
      <div className="container footer-row">
        <span>© {new Date().getFullYear()} {identity?.name} · AlphaShook Corporation</span>
        <Link to="/developers">¿Hacés juegos? Publicalos acá</Link>
      </div>
    </footer>
  );
}

function App() {
  return (
    <SessionProvider>
      <Header />
      <main className="container">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/catalog" element={<CatalogPage />} />
          <Route path="/p/:slug" element={<ProductPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/verify-email" element={<VerifyEmailPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/account" element={<AccountPage />} />
          <Route path="/library" element={<LibraryPage />} />
          <Route path="/wishlist" element={<WishlistPage />} />
          <Route path="/community" element={<ForumsPage />} />
          <Route path="/community/t/:id" element={<ThreadPage />} />
          <Route path="/community/:board" element={<BoardPage />} />
          <Route path="/u/:username" element={<ProfilePage />} />
          <Route path="/friends" element={<FriendsPage />} />
          <Route path="/developers" element={<DevelopersPage />} />
          <Route path="/dev" element={<DevDashboardPage />} />
          <Route path="/dev/new" element={<DevProductPage />} />
          <Route path="/dev/p/:slug" element={<DevProductPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="*" element={<div className="empty">Página no encontrada. <Link to="/">Volver al inicio</Link></div>} />
        </Routes>
      </main>
      <Footer />
    </SessionProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
