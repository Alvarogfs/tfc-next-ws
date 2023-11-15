import { config } from "dotenv";
import express from "express";
import morgan from "morgan";
import helmet from "helmet";
import cors from "cors";
import { createServer } from "http";
import { name } from "../package.json";
import { Server as ServerIo } from "socket.io";
import * as R from "remeda";
config();

type User = {
  id: string;
  name: string;
  email: string;
  image: string;
  socketIds?: Set<string>;
};
const userInRoom = (userId?: string) => {
  return rooms.findIndex((room) =>
    room.users.find((user) => user.id === userId)
  );
};

const users: User[] = [];

function removeUserAndDropRoom(userId: string): void {
  console.log(userId);
  const index = R.pipe(
    rooms,
    R.findIndex((room) => room.users.some((user) => user.id === userId))
  );

  if (index !== -1 && rooms[index]?.users) {
    rooms[index].users = R.pipe(
      rooms[index].users,
      R.filter((user) => user.id !== userId)
    );

    if (rooms[index].users.length === 0) {
      console.log(`Room ${rooms[index].id} dropped as it became empty.`);
      rooms.splice(index, 1);
    } else {
      console.log(`User ${userId} removed from Room ${rooms[index].id}.`);
    }
  } else {
    console.log(`User ${userId} not found in any room.`);
  }
}

const app = express();
app.use(morgan("dev"));
app.use(helmet());

const urls = process.env.ORIGIN_URL?.split(",");
app.use(
  cors({
    origin: urls,
    credentials: true,
    methods: ["GET", "POST"],
  })
);

app.use(express.json());

const server = createServer(app);
const io = new ServerIo(server, {
  cors: {
    origin: [process.env.CLIENT_URL ?? "http://localhost:3000"],
    methods: ["GET", "POST"],
  },
});

const rooms = <{ id: string; users: User[] }[]>[];
const port = process.env.PORT ?? 8000;
server.listen(port, () => {
  /* eslint-disable no-console */
  console.log(`Listening: http://localhost:${port}`);
  /* eslint-enable no-console */
});

io.on("connection", (socket) => {
  socket.on("authenticate", ({ user: data }: { user: User }) => {
    if (!data) return
    if (
      users.find((user) => {
        user.id === data.id;
      })
    ) {
      const userIndex = users.findIndex((user) => {
        user.id === data.id;
      });
      users[userIndex].socketIds?.add(socket.id);
      return;
    }
    if (!data.socketIds) {
      data.socketIds = new Set();
    }
    data.socketIds.add(socket.id);
    users.push(data);
    console.log("authenticate", data);
    socket.broadcast.emit("userConnected", data);
  });


  socket.on("createRoom", (user: User) => {
    if (userInRoom(user.id) !== -1) return;
    console.log("createroom");
    const roomId = crypto.randomUUID()
    rooms.push({
      id: roomId,
      users: [{...user}],
    });
    socket.broadcast.emit("roomCreated");
    socket.emit("roomCreatedSelf", roomId)
  });


  socket.on("joinRoom", (roomId: string, user: User) => {
    const room = rooms.find((room) => room.id === roomId);
    if (room && room.users.length < 2) {
      socket.join(roomId);
      room.users.push(user)
      socket.broadcast.emit("joinedRoom")
    }
  });


  console.log("a user connected");
  console.log("connections", io.engine.clientsCount);

  socket.on("disconnect", () => {
    const user = users.find((user) => user.socketIds?.has(socket.id));
    if (user) removeUserAndDropRoom(user?.id);
    console.log("user disconnected");
    socket.broadcast.emit("userDisconnected")
  });
});

app.get("/", (req, res) => {
  res.json({
    name,
    date: new Date().toLocaleDateString(),
  });
});

app.get("/rooms", (req, res) => {
  res.json(rooms);
});

app.get("/rooms/:id", (req, res) => {
  const room = rooms.find((room) => room.id === req.params.id);
  console.log(rooms)
  if(!room){
    res.status(404)
    return res.send("Not found")
  }
  res.json(room)
});
