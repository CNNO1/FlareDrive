import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ThemeProvider } from "@emotion/react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  CssBaseline,
  Divider,
  GlobalStyles,
  IconButton,
  LinearProgress,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Snackbar,
  Stack,
  TextField,
  Toolbar,
  Tooltip,
  Typography,
  createTheme,
} from "@mui/material";
import {
  ArrowBack as ArrowBackIcon,
  CloudQueue as CloudQueueIcon,
  ContentCopy as ContentCopyIcon,
  CreateNewFolder as CreateNewFolderIcon,
  Delete as DeleteIcon,
  Download as DownloadIcon,
  DriveFileMove as DriveFileMoveIcon,
  Folder as FolderIcon,
  InsertDriveFile as FileIcon,
  LockOutlined as LockIcon,
  Logout as LogoutIcon,
  MoreHoriz as MoreHorizIcon,
  Refresh as RefreshIcon,
  Search as SearchIcon,
  Upload as UploadIcon,
} from "@mui/icons-material";

type DriveItem = {
  key: string;
  name: string;
  type: "file" | "folder";
  size: number;
  updated: string | null;
  contentType: string;
};

type ListResponse = {
  prefix: string;
  items: DriveItem[];
  limits: { maxUploadBytes: number; partSize: number };
};

type UsageResponse = {
  size: number;
  count: number;
  folders: number;
  recommendedLimitBytes: number;
};

type UploadProgress = {
  name: string;
  loaded: number;
  total: number;
  status: "idle" | "uploading" | "done" | "failed";
};

const AUTH_KEY = "flaredrive-light-auth";
const DEFAULT_MAX_UPLOAD = 250 * 1024 * 1024;
const DEFAULT_PART_SIZE = 10 * 1024 * 1024;

const theme = createTheme({
  palette: {
    primary: { main: "#2563eb" },
    secondary: { main: "#f97316" },
    background: { default: "#f6f7f9" },
  },
  shape: { borderRadius: 8 },
});

const globalStyles = (
  <GlobalStyles
    styles={{
      "html, body, #root": { height: "100%" },
      body: { backgroundColor: "#f6f7f9" },
      "*": { boxSizing: "border-box" },
    }}
  />
);

function authHeader(): Record<string, string> {
  const value = window.localStorage.getItem(AUTH_KEY);
  return value ? { Authorization: value } : {};
}

function saveCredentials(username: string, password: string) {
  window.localStorage.setItem(
    AUTH_KEY,
    `Basic ${window.btoa(`${username.trim()}:${password}`)}`
  );
}

function clearCredentials() {
  window.localStorage.removeItem(AUTH_KEY);
}

async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  Object.entries(authHeader()).forEach(([key, value]) => headers.set(key, value));
  if (init.body && !(init.body instanceof Blob)) {
    headers.set("Content-Type", headers.get("Content-Type") || "application/json");
  }

  const response = await fetch(path, { ...init, headers });
  if (response.status === 401) throw new Error("Unauthorized");
  if (!response.ok) {
    let message = response.statusText;
    try {
      const body = (await response.json()) as { error?: string };
      message = body.error || message;
    } catch {
      message = await response.text();
    }
    throw new Error(message || `HTTP ${response.status}`);
  }
  return response.json();
}

function formatBytes(value: number) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function encodeKey(key: string) {
  return encodeURIComponent(key);
}

function parentOf(prefix: string) {
  const parts = prefix.replace(/\/$/, "").split("/").filter(Boolean);
  parts.pop();
  return parts.length ? `${parts.join("/")}/` : "";
}

function joinKey(prefix: string, name: string, folder = false) {
  const cleanName = name.replace(/^\/+|\/+$/g, "");
  const key = `${prefix}${cleanName}`;
  return folder && key ? `${key}/` : key;
}

function webDavUrl() {
  return `${window.location.origin}/webdav`;
}

function Login({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  return (
    <Box
      component="form"
      onSubmit={(event) => {
        event.preventDefault();
        saveCredentials(username, password);
        onLogin();
      }}
      sx={{
        minHeight: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 2,
      }}
    >
      <Paper
        elevation={0}
        sx={{
          width: "100%",
          maxWidth: 400,
          padding: 3,
          border: "1px solid",
          borderColor: "divider",
        }}
      >
        <Stack spacing={2.25}>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Box
              sx={{
                width: 44,
                height: 44,
                display: "grid",
                placeItems: "center",
                borderRadius: 1,
                color: "common.white",
                backgroundColor: "primary.main",
              }}
            >
              <LockIcon />
            </Box>
            <Box>
              <Typography variant="h6" sx={{ lineHeight: 1.2 }}>
                FlareDrive Light
              </Typography>
              <Typography variant="body2" color="text.secondary">
                单用户私有网盘
              </Typography>
            </Box>
          </Stack>
          <Chip
            label="游客不可访问"
            color="primary"
            variant="outlined"
            size="small"
            sx={{ alignSelf: "flex-start" }}
          />
          <TextField
            autoFocus
            label="用户名"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
          <TextField
            label="密码"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <Button
            fullWidth
            type="submit"
            variant="contained"
            disabled={!username || !password}
            sx={{ height: 44 }}
          >
            登录
          </Button>
        </Stack>
      </Paper>
    </Box>
  );
}

function AppShell() {
  const [isAuthed, setIsAuthed] = useState(Boolean(window.localStorage.getItem(AUTH_KEY)));
  const [prefix, setPrefix] = useState("");
  const [items, setItems] = useState<DriveItem[]>([]);
  const [usage, setUsage] = useState<UsageResponse | null>(null);
  const [limits, setLimits] = useState({
    maxUploadBytes: DEFAULT_MAX_UPLOAD,
    partSize: DEFAULT_PART_SIZE,
  });
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<DriveItem | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [message, setMessage] = useState("");
  const [upload, setUpload] = useState<UploadProgress>({
    name: "",
    loaded: 0,
    total: 0,
    status: "idle",
  });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const showError = useCallback((error: unknown) => {
    const text = error instanceof Error ? error.message : String(error);
    if (text === "Unauthorized") {
      clearCredentials();
      setIsAuthed(false);
      setMessage("用户名或密码错误");
      return;
    }
    setMessage(text);
  }, []);

  const load = useCallback(async () => {
    if (!isAuthed) return;
    setLoading(true);
    try {
      const [list, usageData] = await Promise.all([
        apiJson<ListResponse>(`/api/list?prefix=${encodeURIComponent(prefix)}`),
        apiJson<UsageResponse>("/api/usage"),
      ]);
      setItems(list.items);
      setLimits(list.limits);
      setUsage(usageData);
      setSelected(null);
    } catch (error) {
      showError(error);
    } finally {
      setLoading(false);
    }
  }, [isAuthed, prefix, showError]);

  useEffect(() => {
    load();
  }, [load]);

  const filteredItems = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return items;
    return items.filter((item) => item.name.toLowerCase().includes(term));
  }, [items, search]);

  const uploadFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files);
      for (const file of list) {
        const key = joinKey(prefix, file.name);
        let uploadId = "";
        try {
          if (file.size > limits.maxUploadBytes) {
            throw new Error(`网页端单文件上限为 ${formatBytes(limits.maxUploadBytes)}`);
          }
          setUpload({ name: file.name, loaded: 0, total: file.size, status: "uploading" });
          const create = await apiJson<{
            uploadId?: string;
            empty?: boolean;
            partSize?: number;
          }>("/api/multipart/create", {
            method: "POST",
            body: JSON.stringify({
              key,
              size: file.size,
              contentType: file.type || "application/octet-stream",
            }),
          });
          if (create.empty) {
            setUpload({ name: file.name, loaded: file.size, total: file.size, status: "done" });
            continue;
          }
          uploadId = create.uploadId || "";
          const partSize = create.partSize || limits.partSize || DEFAULT_PART_SIZE;
          const parts: { partNumber: number; etag: string }[] = [];
          for (let offset = 0, partNumber = 1; offset < file.size; offset += partSize, partNumber += 1) {
            const chunk = file.slice(offset, Math.min(offset + partSize, file.size));
            const part = await apiJson<{ partNumber: number; etag: string }>(
              `/api/multipart/part?key=${encodeKey(key)}&uploadId=${encodeURIComponent(uploadId)}&partNumber=${partNumber}`,
              {
                method: "PUT",
                headers: { "Content-Type": "application/octet-stream" },
                body: chunk,
              }
            );
            parts.push(part);
            setUpload({
              name: file.name,
              loaded: Math.min(offset + chunk.size, file.size),
              total: file.size,
              status: "uploading",
            });
          }
          await apiJson("/api/multipart/complete", {
            method: "POST",
            body: JSON.stringify({ key, uploadId, parts }),
          });
          setUpload({ name: file.name, loaded: file.size, total: file.size, status: "done" });
        } catch (error) {
          if (uploadId) {
            try {
              await apiJson("/api/multipart/abort", {
                method: "POST",
                body: JSON.stringify({ key, uploadId }),
              });
            } catch {
              // Ignore abort failures; the visible error is the upload failure.
            }
          }
          setUpload({ name: file.name, loaded: 0, total: file.size, status: "failed" });
          showError(error);
          break;
        }
      }
      await load();
    },
    [limits.maxUploadBytes, limits.partSize, load, prefix, showError]
  );

  const createFolder = async () => {
    const name = window.prompt("文件夹名称");
    if (!name) return;
    try {
      await apiJson("/api/folder", {
        method: "POST",
        body: JSON.stringify({ key: joinKey(prefix, name, true) }),
      });
      await load();
    } catch (error) {
      showError(error);
    }
  };

  const deleteItem = async (item: DriveItem) => {
    if (!window.confirm(`确认删除 ${item.name}？`)) return;
    try {
      await apiJson(`/api/object?key=${encodeKey(item.key)}`, { method: "DELETE" });
      await load();
    } catch (error) {
      showError(error);
    }
  };

  const renameItem = async (item: DriveItem) => {
    const name = window.prompt("重命名为", item.name);
    if (!name || name === item.name) return;
    const parent = item.key.slice(0, item.key.length - item.name.length - (item.type === "folder" ? 1 : 0));
    const target = `${parent}${name}${item.type === "folder" ? "/" : ""}`;
    try {
      await apiJson("/api/rename", {
        method: "POST",
        body: JSON.stringify({ from: item.key, to: target }),
      });
      await load();
    } catch (error) {
      showError(error);
    }
  };

  const downloadItem = async (item: DriveItem) => {
    try {
      const response = await fetch(`/api/file?key=${encodeKey(item.key)}`, {
        headers: authHeader(),
      });
      if (response.status === 401) throw new Error("Unauthorized");
      if (!response.ok) throw new Error(await response.text());
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = item.name;
      link.click();
      URL.revokeObjectURL(objectUrl);
    } catch (error) {
      showError(error);
    }
  };

  if (!isAuthed) {
    return <Login onLogin={() => setIsAuthed(true)} />;
  }

  return (
    <Stack sx={{ height: "100%" }}>
      <Toolbar
        disableGutters
        sx={{
          gap: 1,
          paddingX: { xs: 1, sm: 2 },
          borderBottom: "1px solid",
          borderColor: "divider",
          backgroundColor: "background.paper",
        }}
      >
        <CloudQueueIcon color="primary" />
        <Typography variant="subtitle1" sx={{ display: { xs: "none", sm: "block" } }}>
          FlareDrive Light
        </Typography>
        <Box
          sx={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            gap: 1,
            minWidth: 0,
            height: 40,
            paddingX: 1.5,
            borderRadius: "999px",
            backgroundColor: "#f1f5f9",
          }}
        >
          <SearchIcon fontSize="small" color="action" />
          <TextField
            variant="standard"
            placeholder="搜索当前目录"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            fullWidth
            InputProps={{ disableUnderline: true }}
          />
        </Box>
        <Tooltip title="刷新">
          <IconButton onClick={load}>
            <RefreshIcon />
          </IconButton>
        </Tooltip>
        <Tooltip title="退出登录">
          <IconButton
            onClick={() => {
              clearCredentials();
              setIsAuthed(false);
            }}
          >
            <LogoutIcon />
          </IconButton>
        </Tooltip>
      </Toolbar>

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", lg: "320px 1fr" },
          gap: 2,
          padding: { xs: 1, sm: 2 },
          minHeight: 0,
          flex: 1,
          overflow: "hidden",
        }}
      >
        <Stack spacing={2} sx={{ minWidth: 0, overflow: "auto" }}>
          <Paper elevation={0} sx={{ padding: 2, border: "1px solid", borderColor: "divider" }}>
            <Stack spacing={1.5}>
              <Typography variant="subtitle2">映射盘</Typography>
              <TextField
                value={webDavUrl()}
                size="small"
                inputProps={{ readOnly: true }}
                InputProps={{
                  endAdornment: (
                    <Tooltip title="复制">
                      <IconButton
                        edge="end"
                        onClick={() => {
                          navigator.clipboard.writeText(webDavUrl());
                          setMessage("WebDAV 地址已复制");
                        }}
                      >
                        <ContentCopyIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  ),
                }}
              />
              <Alert severity="info" variant="outlined">
                系统映射盘适合浏览、读取和小文件写入；大文件请用网页上传。
              </Alert>
            </Stack>
          </Paper>

          <Paper elevation={0} sx={{ padding: 2, border: "1px solid", borderColor: "divider" }}>
            <Stack spacing={1.5}>
              <Typography variant="subtitle2">容量</Typography>
              <LinearProgress
                variant="determinate"
                value={usage ? Math.min(100, (usage.size / usage.recommendedLimitBytes) * 100) : 0}
              />
              <Stack direction="row" spacing={1} flexWrap="wrap">
                <Chip label={`${formatBytes(usage?.size || 0)} / 3GB 建议`} size="small" />
                <Chip label={`${usage?.count || 0} 个文件`} size="small" />
                <Chip label={`网页上限 ${formatBytes(limits.maxUploadBytes)}`} size="small" color="secondary" />
              </Stack>
            </Stack>
          </Paper>

          <Paper elevation={0} sx={{ padding: 2, border: "1px solid", borderColor: "divider" }}>
            <Stack spacing={1.5}>
              <Button
                variant="contained"
                startIcon={<UploadIcon />}
                onClick={() => fileInputRef.current?.click()}
              >
                网页上传
              </Button>
              <Button
                variant="outlined"
                startIcon={<CreateNewFolderIcon />}
                onClick={createFolder}
              >
                新建文件夹
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                hidden
                onChange={(event) => {
                  if (event.target.files?.length) uploadFiles(event.target.files);
                  event.currentTarget.value = "";
                }}
              />
              {upload.status !== "idle" && (
                <Box>
                  <Typography variant="body2" noWrap>
                    {upload.name}
                  </Typography>
                  <LinearProgress
                    variant="determinate"
                    value={upload.total ? Math.min(100, (upload.loaded / upload.total) * 100) : 0}
                    color={upload.status === "failed" ? "error" : "primary"}
                  />
                  <Typography variant="caption" color="text.secondary">
                    {formatBytes(upload.loaded)} / {formatBytes(upload.total)}
                  </Typography>
                </Box>
              )}
            </Stack>
          </Paper>
        </Stack>

        <Paper
          elevation={0}
          onDragEnter={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            if (event.dataTransfer.files.length) uploadFiles(event.dataTransfer.files);
          }}
          sx={{
            minHeight: 0,
            overflow: "hidden",
            border: "1px solid",
            borderColor: dragging ? "primary.main" : "divider",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <Stack
            direction="row"
            alignItems="center"
            spacing={1}
            sx={{ padding: 1.5, borderBottom: "1px solid", borderColor: "divider" }}
          >
            <Button
              size="small"
              startIcon={<ArrowBackIcon />}
              disabled={!prefix}
              onClick={() => setPrefix(parentOf(prefix))}
            >
              上一级
            </Button>
            <Typography variant="body2" color="text.secondary" noWrap sx={{ flex: 1 }}>
              /{prefix}
            </Typography>
            {loading && <CircularProgress size={20} />}
          </Stack>
          <List dense disablePadding sx={{ overflow: "auto", flex: 1 }}>
            {filteredItems.length === 0 && !loading ? (
              <Box sx={{ padding: 4, textAlign: "center", color: "text.secondary" }}>
                当前目录为空
              </Box>
            ) : (
              filteredItems.map((item) => (
                <React.Fragment key={item.key}>
                  <ListItemButton
                    selected={selected?.key === item.key}
                    onClick={() => {
                      setSelected(item);
                      if (item.type === "folder") setPrefix(item.key);
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setSelected(item);
                      setMenuAnchor(event.currentTarget);
                    }}
                  >
                    <ListItemIcon>
                      {item.type === "folder" ? <FolderIcon color="primary" /> : <FileIcon />}
                    </ListItemIcon>
                    <ListItemText
                      primary={item.name}
                      secondary={
                        item.type === "folder"
                          ? "文件夹"
                          : `${formatBytes(item.size)} · ${
                              item.updated ? new Date(item.updated).toLocaleString() : ""
                            }`
                      }
                      primaryTypographyProps={{ noWrap: true }}
                      secondaryTypographyProps={{ noWrap: true }}
                    />
                    <IconButton
                      edge="end"
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelected(item);
                        setMenuAnchor(event.currentTarget);
                      }}
                    >
                      <MoreHorizIcon />
                    </IconButton>
                  </ListItemButton>
                  <Divider component="li" />
                </React.Fragment>
              ))
            )}
          </List>
        </Paper>
      </Box>

      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
        <MenuItem
          disabled={!selected || selected.type === "folder"}
          onClick={() => {
            if (selected) downloadItem(selected);
            setMenuAnchor(null);
          }}
        >
          <DownloadIcon fontSize="small" sx={{ marginRight: 1 }} />
          下载
        </MenuItem>
        <MenuItem
          disabled={!selected}
          onClick={() => {
            if (selected) renameItem(selected);
            setMenuAnchor(null);
          }}
        >
          <DriveFileMoveIcon fontSize="small" sx={{ marginRight: 1 }} />
          重命名
        </MenuItem>
        <MenuItem
          disabled={!selected}
          onClick={() => {
            if (selected) deleteItem(selected);
            setMenuAnchor(null);
          }}
        >
          <DeleteIcon fontSize="small" sx={{ marginRight: 1 }} />
          删除
        </MenuItem>
      </Menu>

      <Snackbar
        open={Boolean(message)}
        autoHideDuration={5000}
        message={message}
        onClose={() => setMessage("")}
      />
    </Stack>
  );
}

function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {globalStyles}
      <AppShell />
    </ThemeProvider>
  );
}

export default App;
