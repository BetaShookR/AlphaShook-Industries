import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Link, Route, Routes } from "react-router";
import "./styles.css";
import { SessionProvider, useSession } from "./hooks";
import { Header } from "./components/ui";
import { CatalogPage, HomePage, ProductPage } from "./pages/store";
import { LibraryPage, WishlistPage } from "./pages/library";
import { BoardPage, ForumsPage, FriendsPage, ProfilePage, ThreadPage } from "./pages/community";
import { AccountPage, ForgotPasswordPage, LoginPage, RegisterPage, ResetPasswordPage, VerifyEmailPage } from "./pages/account";

function Footer() {
  const { identity } = useSession();
  return (
    <footer className="footer">
      <div className="container">© {new Date().getFullYear()} {identity?.name} · AlphaShook Corporation</div>
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
