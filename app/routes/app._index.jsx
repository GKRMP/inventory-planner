import { useEffect } from "react";
import { useNavigate } from "react-router";
import { authenticate } from "../shopify.server";

export async function loader({ request }) {
  await authenticate.admin(request);
  return null;
}

export default function Index() {
  const navigate = useNavigate();

  useEffect(() => {
    navigate("/app/dashboard");
  }, [navigate]);

  return null;
}
