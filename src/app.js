import express from 'express'
import bodyParser from 'body-parser'
import { isAddress, isAccountOwner, isAddressOwner, toContentHash, toUserProfileName, encodeMethod } from './helpers'

export default ({ fb, feed, users, achievements, rewards, qtum, token, depositMethodABI, supportMethodABI, options }) => {
  const app = express()
  app.use(bodyParser())

  const transactionsPending = {}

  app.use((req, res, next) => {
    console.log('request', req.body)
    next()
  })

  app.get('/ping', (req, res) => {
    res.json({ pong: 'pong' })
  })

  app.post('/check', async (req, res) => {
    try {
      const { user } = req.body

      if (transactionsPending[user] === true) {
        return res.json({ exists: false, pending: true })
      }

      const account = (await users.call('accountExists', [user])).outputs[0]

      if (account) {
        return res.json({ exists: true })
      } else {
        return res.json({ exists: false })
      }
    } catch (error) {
      console.error(error)
      res.status(500).send({ error: error.toString() })
    }
  })

  app.post('/check-qtum-address', async (req, res) => {
    try {
      const { user, walletAddress } = req.body

      const hexWalletAddress = await qtum.getHexAddress(walletAddress)

      const address = (await users.call('getAddressByAccount', [user])).outputs[0]

      if (address === hexWalletAddress) {
        return res.json({ ok: true, user, walletAddress, address })
      } else {
        return res.json({ ok: false, user, walletAddress, address })
      }
    } catch (error) {
      console.error(error)
      res.status(500).send({ error: error.toString() })
    }
  })

  app.get('/users', async (req, res) => {
    try {
      let usersList = []

      const numberOfUsers = (await users.call('getUsersCount')).outputs[0]

      for (let index = 0; index < numberOfUsers; index++) {
        const [ userHexAddress, userAccount, userName ] =
          (await users.call('getUserByIndex', [index])).outputs

        const userAddress = await qtum.fromHexAddress(userHexAddress)

        usersList.push({
          userAddress, userAccount, userName
        })
      }

      return res.json({ usersList })
    } catch (error) {
      console.error(error)
      res.status(500).send({ error: error.toString() })
    }
  })

  app.post('/getAccessToken', async (req, res) => {
    try {
      const { address, user, token } = req.body

      if (!isAddress(address)) {
        return res.status(500).json({ error: 'INVALID_ADDRESS ' })
      }

      if (!isAccountOwner(fb, user, token)) {
        return res.status(500).json({ error: 'INVALID_TOKEN' })
      }

      const hexAddress = await qtum.getHexAddress(address)

      const checkedAddressOwner = await isAddressOwner(users, hexAddress, user)

      if (!checkedAddressOwner) {
        return res.status(500).json({ error: 'INVALID_ADDRESS_OWNER' })
      }

      const accessToken = token(address)

      res.json({ accessToken: accessToken, address, user })
    } catch (error) {
      console.error(error)
      res.status(500).send({ error: error.toString() })
    }
  })

  app.post('/register', async (req, res) => {
    try {
      const { address, user, token } = req.body

      if (!isAddress(address)) {
        return res.status(500).json({ error: 'INVALID_ADDRESS' })
      }

      if (!isAccountOwner(fb, user, token)) {
        return res.status(500).json({ error: 'INVALID_TOKEN' })
      }

      const hexAddress = await qtum.getHexAddress(address)

      const userExists = (await users.call('exists', [hexAddress])).outputs[0]

      if (userExists) {
        return res.status(500).json({ error: 'USER_EXISTS' })
      }

      const userProfileName = await toUserProfileName(fb, user)

      const args = [hexAddress, user, userProfileName]

      console.log('register', args)

      const transaction = await users.send('register', args, options)

      const { txid } = transaction

      await feed.addActivity({
        actor: user,
        object: address,
        target: txid,
        name: userProfileName,
        verb: 'register'
      })

      res.json({ user, address, hexAddress, userProfileName, txid })

      transactionsPending[user] = true
      await transaction.confirm(1)
      transactionsPending[user] = false
    } catch (e) {
      console.error(e)
      res.status(500).send({ error: e.toString() })
    }
  })

  app.post('/confirm', async (req, res) => {
    try {
      const { address, user, token, link } = req.body

      if (!isAddress(address)) {
        return res.status(500).json({ error: 'INVALID_ADDRESS ' })
      }

      if (!isAccountOwner(fb, user, token)) {
        return res.status(500).json({ error: 'INVALID_TOKEN' })
      }

      const hexAddress = await qtum.getHexAddress(address)

      const checkedAddressOwner = await isAddressOwner(users, hexAddress, user)

      if (!checkedAddressOwner) {
        return res.status(500).json({ error: 'INVALID_ADDRESS_OWNER' })
      }

      const args = [hexAddress, link]

      console.log('confirmFrom', args)

      const transaction = await achievements.send('confirmFrom', args, options)

      const { txid } = transaction

      const userProfileName = await toUserProfileName(fb, user)

      await feed.addActivity({
        actor: user,
        object: link,
        target: txid,
        name: userProfileName,
        verb: 'confirm'
      })

      res.json({ user, address, hexAddress, link, userProfileName, txid })
    } catch (e) {
      console.error(e)
      res.status(500).send({ error: e.toString() })
    }
  })

  app.post('/create', async (req, res) => {
    try {
      const { user, token, address, link, title, previousLink } = req.body

      if (!isAddress(address)) {
        return res.status(500).json({ error: 'INVALID_ADDRESS' })
      }

      if (!isAccountOwner(fb, user, token)) {
        return res.status(500).json({ error: 'INVALID_TOKEN' })
      }

      const hexAddress = await qtum.getHexAddress(address)

      const checkedAddressOwner = await isAddressOwner(users, hexAddress, user)

      if (!checkedAddressOwner) {
        return res.status(500).json({ error: 'INVALID_ADDRESS_OWNER' })
      }

      const contentHash = toContentHash(link)

      let args = [hexAddress, link, contentHash, title, previousLink]

      console.log('create', args)

      const transaction = await achievements.send('createFrom', args, options)

      const { txid } = transaction

      const verb = previousLink ? 'update' : 'create'

      const userProfileName = await toUserProfileName(fb, user)

      await feed.addActivity({
        actor: user,
        object: link,
        target: txid,
        verb: verb,
        name: userProfileName
      })

      res.json({ user, address, hexAddress, link, title, previousLink, txid, userProfileName, contentHash })
    } catch (e) {
      console.error(e)
      res.sendStatus(500).send({ error: e.toString() })
    }
  })

  app.post('/withdraw', async (req, res) => {
    try {
      const { link, witness } = req.body

      if (!isAddress(witness)) {
        return res.status(500).json({ error: 'INVALID_ADDRESS' })
      }

      const hexWitness = await qtum.getHexAddress(witness)

      const args = [link, hexWitness]

      console.log('withdraw', args)

      const { txid } = await rewards.send('withdraw', args, options)

      await feed.addActivity({
        actor: witness,
        object: link,
        target: txid,
        verb: 'withdraw'
      })

      res.json({ txid, link, witness, hexWitness })
    } catch (e) {
      console.error(e)
      res.status(500).send({ error: e.toString() })
    }
  })

  app.post('/encode-support', async (req, res) => {
    try {
      const { link } = req.body

      const address = rewards.address

      const encodedData = encodeMethod(supportMethodABI, [link])

      res.json({ address, link, encodedData })
    } catch (e) {
      console.error(e)
      res.status(500).send({ error: e.toString() })
    }
  })

  app.post('/encode-deposit', async (req, res) => {
    try {
      const { link, witness } = req.body

      const address = rewards.address

      const hexWitnessAddress = await qtum.getHexAddress(witness)

      const ethWitnessAddress = `0x${hexWitnessAddress}`

      console.log(ethWitnessAddress)

      const encodedData = encodeMethod(depositMethodABI, [link, ethWitnessAddress])

      res.json({ address, link, witness, encodedData })
    } catch (e) {
      console.error(e)
      res.status(500).send({ error: e.toString() })
    }
  })

  app.post('/init', async (req, res) => {
    try {
      const initializedAddress = (await achievements.call('rewards')).outputs[0]

      if (parseInt(initializedAddress) !== 0) {
        return res.status(500).json({ error: 'ALREADY_INITIALIZED', initializedAddress })
      }

      const rewardsAddress = rewards.address

      const { txid } = await achievements.send('initRewards', [rewardsAddress], options)

      res.json({ txid, rewardsAddress })
    } catch (e) {
      console.error(e)
      res.status(500).send({ error: e.toString() })
    }
  })

  app.post('/support', async (req, res) => {
    try {
      const { rawTx, link, address, user, token } = req.body

      if (!isAddress(address)) {
        return res.status(500).json({ error: 'INVALID_ADDRESS' })
      }

      if (!isAccountOwner(fb, user, token)) {
        return res.status(500).json({ error: 'INVALID_TOKEN' })
      }

      const hexAddress = await qtum.getHexAddress(address)

      const checkedAddressOwner = await isAddressOwner(users, hexAddress, user)

      if (!checkedAddressOwner) {
        return res.status(500).json({ error: 'INVALID_ADDRESS_OWNER' })
      }

      const decodedTx = await qtum.rawCall('decoderawtransaction', [rawTx])

      console.log('decodedTx', JSON.stringify(decodedTx))

      const txid = await qtum.rawCall('sendrawtransaction', [rawTx])

      const userProfileName = await toUserProfileName(fb, user)

      await feed.addActivity({
        actor: address,
        object: link,
        target: txid,
        name: userProfileName,
        verb: 'support'
      })

      res.json({ txid, link, address, userProfileName, user })
    } catch (e) {
      console.error(e)
      res.status(500).send({ error: e.toString() })
    }
  })

  app.post('/deposit', async (req, res) => {
    try {
      const { rawTx, link, witness, address, user, token, witnessName } = req.body

      if (!isAddress(address)) {
        return res.status(500).json({ error: 'INVALID_ADDRESS' })
      }

      if (!isAccountOwner(fb, user, token)) {
        return res.status(500).json({ error: 'INVALID_TOKEN' })
      }

      const hexAddress = await qtum.getHexAddress(address)

      const checkedAddressOwner = await isAddressOwner(users, hexAddress, user)

      if (!checkedAddressOwner) {
        return res.status(500).json({ error: 'INVALID_ADDRESS_OWNER' })
      }

      const txid = await qtum.rawCall('sendrawtransaction', [rawTx])

      const userProfileName = await toUserProfileName(fb, user)

      await feed.addActivity({
        actor: address,
        object: link,
        witness: witness,
        target: txid,
        name: userProfileName,
        witnessName: witnessName,
        verb: 'deposit'
      })

      res.json({ txid, link, witness, address, userProfileName, user })
    } catch (e) {
      console.error(e)
      res.status(500).send({ error: e.toString() })
    }
  })

  return app
}
