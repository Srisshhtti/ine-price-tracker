import { useEffect, useState } from "react";
import axios from "axios";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import "./App.css";

const API = import.meta.env.VITE_API_URL || "http://localhost:5000";

function App() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null);
  const [details, setDetails] = useState(null);
  const [option, setOption] = useState("");
  const [tracked, setTracked] = useState([]);
  const [history, setHistory] = useState({});
  const [logs, setLogs] = useState({});
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const loadTracked = async () => {
    const r = await axios.get(`${API}/api/tracked`);
    setTracked(r.data);
  };

  useEffect(() => {
    loadTracked();
  }, []);

  const search = async () => {
    if (!query.trim()) return;
    setLoading(true);
    try {
      const r = await axios.get(
        `${API}/api/products/search?q=${encodeURIComponent(query)}`
      );
      setResults(r.data);
    } catch {
      setMessage("Search failed");
    } finally {
      setLoading(false);
    }
  };

  const chooseProduct = async (p) => {
    setSelected(p);
    const r = await axios.get(`${API}/api/products/${p.id}`);
    setDetails(r.data);
    setOption(r.data.options?.[0]?.label || "");
  };

  const track = async () => {
    if (!selected || !details || !option) return;

    const opt =
      details.options.find((x) => x.label === option) || {
        id: option,
        label: option,
      };

    await axios.post(`${API}/api/tracked`, {
      store_product_id: selected.id,
      product_name: selected.name,
      product_url: selected.url,
      selected_option: opt.label,
      selected_option_id: opt.id,
    });

    setMessage("Product tracking started");
    await loadTracked();
  };

  const scrape = async (id) => {
    setMessage("Scraping...");

    try {
      await axios.post(`${API}/api/tracked/${id}/scrape`);
      setMessage("Scrape completed. Check logs below.");
      await loadTracked();

      const h = await axios.get(`${API}/api/tracked/${id}/history`);
      const l = await axios.get(`${API}/api/tracked/${id}/logs`);

      setHistory((x) => ({ ...x, [id]: h.data }));
      setLogs((x) => ({ ...x, [id]: l.data }));
    } catch (e) {
      setMessage("Scrape request failed");
    }
  };

  const loadData = async (id) => {
    const [h, l] = await Promise.all([
      axios.get(`${API}/api/tracked/${id}/history`),
      axios.get(`${API}/api/tracked/${id}/logs`),
    ]);

    setHistory((x) => ({ ...x, [id]: h.data }));
    setLogs((x) => ({ ...x, [id]: l.data }));
  };

  return (
    <div className="app">
      <header>
        <h1>INE Price & Stock Tracker</h1>
        <p>Track product variants, scrape history and stock changes.</p>
      </header>

      <section className="card">
        <h2>Search Products</h2>

        <div className="search">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && search()}
            placeholder="Search product name..."
          />
          <button onClick={search}>
            {loading ? "Searching..." : "Search"}
          </button>
        </div>

        {results.map((p) => (
          <div className="result" key={p.id}>
            <div>
              <strong>{p.name}</strong>
              <small>{p.url}</small>
            </div>
            <button onClick={() => chooseProduct(p)}>Select</button>
          </div>
        ))}

        {details && (
          <div className="optionBox">
            <h3>{details.name}</h3>

            <select value={option} onChange={(e) => setOption(e.target.value)}>
              {details.options?.map((o) => (
                <option key={o.id} value={o.label}>
                  {o.label}
                </option>
              ))}
            </select>

            <button onClick={track}>Track This Option</button>
          </div>
        )}
      </section>

      <section className="card">
        <div className="sectionHeader">
          <h2>Tracked Products</h2>

          <a href={`${API}/api/export.csv`} target="_blank">
            <button>Export CSV</button>
          </a>
        </div>

        {message && <div className="message">{message}</div>}

        {tracked.length === 0 && <p>No products tracked yet.</p>}

        {tracked.map((p) => (
          <div className="tracked" key={p.id}>
            <div className="trackedTop">
              <div>
                <h3>{p.product_name}</h3>
                <p>Option: {p.selected_option}</p>
                <p>
                  Current price:{" "}
                  {p.current_price != null ? `₹${p.current_price}` : "N/A"}
                </p>
                <p>
                  Stock:{" "}
                  {p.current_stock != null ? p.current_stock : "N/A"}
                </p>
                <p>
                  Last scraped:{" "}
                  {p.last_scraped_at
                    ? new Date(p.last_scraped_at).toLocaleString()
                    : "Never"}
                </p>
              </div>

              <div>
                <button onClick={() => scrape(p.id)}>Scrape Now</button>
                <button onClick={() => loadData(p.id)}>Load History</button>
              </div>
            </div>

            {history[p.id]?.length > 0 && (
              <div className="chart">
                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={history[p.id]}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="timestamp" />
                    <YAxis />
                    <Tooltip />
                    <Line
                      type="monotone"
                      dataKey="price"
                      strokeWidth={2}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

            {logs[p.id] && (
              <div>
                <h4>Scrape Attempts</h4>
                <table>
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Attempt</th>
                      <th>Outcome</th>
                      <th>Price</th>
                      <th>Stock</th>
                      <th>Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs[p.id].map((l) => (
                      <tr key={l.id}>
                        <td>{new Date(l.timestamp).toLocaleString()}</td>
                        <td>{l.attempt_number}</td>
                        <td>{l.outcome}</td>
                        <td>{l.price ?? "-"}</td>
                        <td>{l.stock ?? "-"}</td>
                        <td>{l.error_message || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}

export default App;
