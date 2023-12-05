import { config } from "dotenv";
import express from "express";
import morgan from "morgan";
import helmet from "helmet";
import cors from "cors";
import { createServer } from "http";
import { name } from "../package.json";
import { Server as ServerIo } from "socket.io";
import { Pokemon, PokemonStats } from "./pokemon.types";
import * as R from "remeda";
config();

type User = {
  id: string;
  name: string;
  email: string;
  image: string;
  status: string;
  pokemon?: Pokemon;
  socketIds?: Set<string>;
  interval?: string;
};
const users: User[] = [];
const rooms = <{ id: string; users: User[] }[]>[];

const userInRoom = (userId: string) => {
  return rooms.findIndex((room) =>
    room.users.find((user) => user.id === userId)
  );
};

function getUser(userId: string) {
  for (const room of rooms) {
    const user = room.users.find((user) => user.id === userId);
    if (user) {
      return user;
    }
  }
  return undefined;
}

function removeUserAndDropRoom(userId: string): string {
  const index = R.pipe(
    rooms,
    R.findIndex((room) => room.users.some((user) => user.id === userId))
  );
  let roomId = "";
  if (index !== -1 && rooms[index]?.users) {
    roomId = rooms[index].id;
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
  return roomId;
}

const stats = (pokemon: Pokemon) => {
  const hp = pokemon.stats.find((stat) => {
    return stat.stat.name === "hp";
  })?.base_stat;
  const attack = pokemon.stats.find((stat) => {
    return stat.stat.name === "attack";
  })?.base_stat;
  const defense = pokemon.stats.find((stat) => {
    return stat.stat.name === "defense";
  })?.base_stat;
  const special_attack = pokemon.stats.find((stat) => {
    return stat.stat.name === "special-attack";
  })?.base_stat;
  const special_defense = pokemon.stats.find((stat) => {
    return stat.stat.name === "special-defense";
  })?.base_stat;
  const speed = pokemon.stats.find((stat) => {
    return stat.stat.name === "speed";
  })?.base_stat;
  return {
    hp,
    attack,
    defense,
    special_attack,
    special_defense,
    speed,
  } as PokemonStats;
};

function attackPerSec(speed: number): number {
  return 1 / (speed / 150);
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

const port = process.env.PORT ?? 8000;
server.listen(port, () => {
  /* eslint-disable no-console */
  console.log(`Listening: http://localhost:${port}`);
  /* eslint-enable no-console */
});

io.on("connection", (socket) => {
  socket.on("authenticate", ({ user: data }: { user: User }) => {
    if (!data) return;
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
    const roomId = crypto.randomUUID();
    rooms.push({
      id: roomId,
      users: [],
    });
    socket.broadcast.emit("roomCreated");
    socket.emit("roomCreatedSelf", roomId);
  });

  socket.on("joinRoom", (roomId: string, user: User) => {
    const room = rooms.find((room) => room.id === roomId);
    if (room && room.users.length < 2) {
      socket.join(roomId);
      console.log(user, roomId, "joined");
      room.users.push(user);
      socket.broadcast.emit("joinedRoom");
      io.to(roomId).emit(`joinedRoom-${roomId}`, user);
    }
  });

  console.log("a user connected");
  console.log("connections", io.engine.clientsCount);

  socket.on("playerReady", (user: User) => {
    const userReference = getUser(user.id);
    if (!userReference) return;
    userReference.status = "ready";
    const roomIndex = userInRoom(user.id);
    if (rooms[roomIndex].users.every((user) => user.status === "ready")) {
      io.to(rooms[roomIndex].id).emit("allReady");
    }
  });
  socket.on("pokemonChosen", (user: User, pokemon: Pokemon) => {
    const userReference = getUser(user.id);
    if (!userReference) return;
    userReference.status = "chosen";
    const roomIndex = userInRoom(user.id);
    userReference.pokemon = pokemon;
    if (rooms[roomIndex].users.every((user) => user.status === "chosen")) {
      io.to(rooms[roomIndex].id).emit("allChosen");
      const [player1, player2] = rooms[roomIndex].users;
      if (!player1.pokemon || !player2.pokemon) return;
      const statsPlayer1 = stats(player1.pokemon);
      const statsPlayer2 = stats(player2.pokemon);
      const attackPerSecond1 = attackPerSec(statsPlayer1.speed);
      const attackPerSecond2 = attackPerSec(statsPlayer2.speed);
      io.to(rooms[roomIndex].id).emit("attack", {
        [player1?.id]: statsPlayer1,
        [player2?.id]: statsPlayer2,
      });
      const player1Interval = setInterval(() => {
        const [player1, player2] = rooms[roomIndex].users;
        if(!player1?.id || !player2?.id) {
          clearInterval(player1Interval)
        }
        console.log("Player 1 attack :3");
        if (
          statsPlayer1.attack - statsPlayer2.defense >
          statsPlayer1.special_attack - statsPlayer2.special_defense
        ) {
          statsPlayer2.hp -= Math.max(statsPlayer1.attack - statsPlayer2.defense, 5);
        } else {
          statsPlayer2.hp -=
            Math.max(statsPlayer1.special_attack - statsPlayer2.special_defense, 5);
        }
        if(statsPlayer2.hp <= 0) {
          clearInterval(player1Interval)
          clearInterval(player2Interval)
          io.to(rooms[roomIndex].id).emit('victory', player1.id);
        }
        io.to(rooms[roomIndex].id).emit("attack", {
          [player1?.id]: statsPlayer1,
          [player2?.id]: statsPlayer2,
        });
      }, 2000 / attackPerSecond1);

      const player2Interval = setInterval(() => {
        const [player1, player2] = rooms[roomIndex].users;
        if(!player1?.id || !player2?.id) {
          clearInterval(player2Interval)
        }
        console.log("Player 2 attack ¬¬");
        if (
          statsPlayer2.attack - statsPlayer1.defense >
          statsPlayer2.special_attack - statsPlayer1.special_defense
        ) {
          statsPlayer1.hp -= Math.max(statsPlayer2.attack - statsPlayer1.defense, 5);
        } else {
          statsPlayer1.hp -=
            Math.max(statsPlayer2.special_attack - statsPlayer1.special_defense, 5);
        }
        if(statsPlayer1.hp <= 0) {
          clearInterval(player1Interval)
          clearInterval(player2Interval)
          io.to(rooms[roomIndex].id).emit('victory', player2.id);
        }
        io.to(rooms[roomIndex].id).emit("attack", {
          [player1?.id]: statsPlayer1,
          [player2?.id]: statsPlayer2,
        });
      }, 2000 / attackPerSecond2);
    }
  });
  socket.on("disconnect", () => {
    const user = users.find((user) => user.socketIds?.has(socket.id));
    if (user) {
      const roomId = removeUserAndDropRoom(user?.id);
      io.to(roomId).emit(`disconnect-${roomId}`, user);
    }
    console.log("user disconnected");
    socket.broadcast.emit("userDisconnected");
  });

  socket.on("exit", (userId: string) => {
    const user = users.find((user) => user.socketIds?.has(socket.id));
    if (user) {
      const roomId = removeUserAndDropRoom(user?.id);
      io.to(roomId).emit(`disconnect-${roomId}`, user);
      socket.leave(roomId);
    }
    console.log("user exit");
    io.emit("userExit", userId);
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
  if (!room) {
    res.status(404);
    return res.send("Not found");
  }
  res.json(room);
});
